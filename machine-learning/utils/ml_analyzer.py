#!/usr/bin/env python3
"""ML Analyzer script

This script is invoked by the Node mlController using the following CLI:

python ml_analyzer.py --data <tmp_json_file> --behavior <behavior_type>

It must read the JSON payload from the file, run the behaviour specific
model/prediction logic, and write a single JSON object **to stdout** so that
Node.js can capture and forward it to the client.

For the purposes of this repo (demo / placeholder), we implement a very light
weight random-based detector. The interface can later be replaced by real
model inference code with minimal changes (just replace `_predict`).
"""

# fmt: off
import argparse
import base64
import json
import os
import sys
from io import BytesIO
from typing import Any, Dict, List

# Silence any prints while importing model_loader to keep stdout clean
import contextlib
import io

import torch
from PIL import Image
from torchvision import transforms

# Local util that loads and caches models
_silent = io.StringIO()
with contextlib.redirect_stdout(_silent):
    from model_loader import load_all_models

# For eye gaze preprocessing
import numpy as np
import mediapipe as mp

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------


DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
# Load *once* so subsequent calls are fast
MODELS = load_all_models()


# Common image transform (matches notebook training — 64×64 RGB, no normalisation)
IMAGE_SIZE = 64
_IMAGE_TF = transforms.Compose([
    transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
    transforms.ToTensor(),  # outputs [0,1] float32
])

# Mediapipe FaceMesh for eye region extraction
_mp_face_mesh = mp.solutions.face_mesh.FaceMesh(
    static_image_mode=True,
    max_num_faces=1,
    refine_landmarks=False,
)

# Landmarks indices around both eyes (approx.)
_EYE_IDXS = [
    33, 246, 161, 160, 159, 158, 157, 173, 133, 7, 163, 144, 145, 153,
    362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380
]

# MediaPipe Hands and Pose instances
_mp_hands = mp.solutions.hands.Hands(static_image_mode=True, max_num_hands=2)
_mp_pose = mp.solutions.pose.Pose(static_image_mode=True)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _decode_image(data_url: str) -> Image.Image:
    """Convert a base-64 data-URL string to a PIL Image."""

    # Expected format: "data:image/jpeg;base64,<encoded>"
    if "," in data_url:
        _, b64 = data_url.split(",", 1)
    else:
        b64 = data_url
    try:
        byte_data = base64.b64decode(b64)
        return Image.open(BytesIO(byte_data)).convert("RGB")
    except Exception as exc:
        raise ValueError(f"Invalid base64 image: {exc}") from exc


def _frames_to_tensor(frames: List[str]) -> torch.Tensor:
    """Turn list of base64 images into (T, C, H, W) float tensor."""

    tensors = []
    for f in frames:
        try:
            img = _decode_image(f)
            tensors.append(_IMAGE_TF(img))
        except Exception:
            continue
    if not tensors:
        raise ValueError("No valid images provided")
    return torch.stack(tensors, dim=0)  # (T, 3, H, W)


def _eye_crop(img: Image.Image) -> Image.Image | None:
    """Return a 64×64 crop that covers both eyes or None if no face."""

    rgb = np.array(img)  # PIL to numpy RGB
    results = _mp_face_mesh.process(rgb)
    if not results.multi_face_landmarks:
        return None

    h, w, _ = rgb.shape
    xs, ys = [], []
    for lm_idx in _EYE_IDXS:
        lm = results.multi_face_landmarks[0].landmark[lm_idx]
        xs.append(lm.x * w)
        ys.append(lm.y * h)

    x_min, x_max = max(min(xs) - 10, 0), min(max(xs) + 10, w)
    y_min, y_max = max(min(ys) - 10, 0), min(max(ys) + 10, h)

    if x_max - x_min < 10 or y_max - y_min < 10:
        return None

    crop = rgb[int(y_min): int(y_max), int(x_min): int(x_max)]
    if crop.size == 0:
        return None
    crop_pil = Image.fromarray(crop)
    return crop_pil


def _hand_crop(img: Image.Image) -> Image.Image | None:
    """Return crop around first detected hand suitable for tapping models."""

    rgb = np.array(img)
    results = _mp_hands.process(rgb)
    if not results.multi_hand_landmarks:
        return None

    h, w, _ = rgb.shape
    xs, ys = [], []
    for lm in results.multi_hand_landmarks[0].landmark:
        xs.append(lm.x * w)
        ys.append(lm.y * h)

    x_min, x_max = max(min(xs) - 10, 0), min(max(xs) + 10, w)
    y_min, y_max = max(min(ys) - 10, 0), min(max(ys) + 10, h)
    if x_max - x_min < 10 or y_max - y_min < 10:
        return None
    crop = rgb[int(y_min): int(y_max), int(x_min): int(x_max)]
    if crop.size == 0:
        return None
    return Image.fromarray(crop)


def _foot_crop(img: Image.Image) -> Image.Image | None:
    """Return crop around feet region using Pose landmarks (ankles)."""

    rgb = np.array(img)
    results = _mp_pose.process(rgb)
    if not results.pose_landmarks:
        return None

    h, w, _ = rgb.shape
    # ankle indices 27 (left) and 28 (right)
    ankles = [results.pose_landmarks.landmark[i] for i in (27, 28)]
    xs = [a.x * w for a in ankles]
    ys = [a.y * h for a in ankles]
    x_min, x_max = max(min(xs) - 20, 0), min(max(xs) + 20, w)
    y_min, y_max = max(min(ys) - 20, 0), min(max(ys) + 20, h)
    if x_max - x_min < 10 or y_max - y_min < 10:
        return None
    crop = rgb[int(y_min): int(y_max), int(x_min): int(x_max)]
    if crop.size == 0:
        return None
    return Image.fromarray(crop)


def _pose_xy(img: Image.Image) -> List[float] | None:
    """Extract 33 (x,y) pose landmarks as flat list normalized to image size."""
    rgb = np.array(img)
    res = _mp_pose.process(rgb)
    if not res.pose_landmarks:
        return None
    h, w, _ = rgb.shape
    coords = []
    for lm in res.pose_landmarks.landmark:
        coords.extend([lm.x, lm.y])  # already normalized
    return coords


def _simple_movement_analysis(frames: List[str]) -> bool:
    """Enhanced movement analysis for foot tapping fallback."""
    if len(frames) < 2:
        return False
    
    try:
        movement_scores = []
        motion_detections = 0
        
        for i in range(len(frames) - 1):  # Compare consecutive frames
            img1 = _decode_image(frames[i])
            img2 = _decode_image(frames[i + 1])
            
            # Convert to grayscale and resize for comparison
            gray1 = img1.convert('L').resize((100, 100))
            gray2 = img2.convert('L').resize((100, 100))
            
            # Calculate frame difference
            arr1 = np.array(gray1, dtype=np.float32)
            arr2 = np.array(gray2, dtype=np.float32)
            diff = float(np.mean(np.abs(arr1 - arr2)) / 255.0)
            
            # Also check for localized motion (foot tapping area)
            motion_threshold = 25.0  # Reasonable threshold for movement detection
            motion_mask = np.abs(arr1 - arr2) > motion_threshold
            motion_ratio = float(np.sum(motion_mask) / motion_mask.size)
            
            # Combined score considering both overall and localized movement
            if motion_ratio > 0.02:  # If more than 2% of image changed significantly
                combined_score = (diff * 0.6) + (motion_ratio * 0.4)
            else:
                combined_score = diff * 0.4  # Penalty for small movements
            
            movement_scores.append(combined_score)
            
            # Count frames with meaningful motion
            if combined_score > 0.008 or motion_ratio > 0.025:
                motion_detections += 1
                
        if not movement_scores:
            return False
        
        # Use both maximum movement and motion detection count
        max_movement = max(movement_scores)
        avg_movement = sum(movement_scores) / len(movement_scores)
        
        print(f"Movement analysis: max={max_movement:.3f}, avg={avg_movement:.3f}, motion_detections={motion_detections}", file=sys.stderr)
        
        # Extremely permissive detection for foot tapping
        has_significant_movement = max_movement > 0.005  # Very low threshold
        has_consistent_motion = motion_detections >= 1 or avg_movement > 0.002  # Very permissive
        
        detected = has_significant_movement or has_consistent_motion
        print(f"Movement detection result: {detected} (significant={has_significant_movement}, consistent={has_consistent_motion})", file=sys.stderr)
        
        return detected
        
    except Exception as e:
        print(f"Movement analysis error: {e}", file=sys.stderr)
        return False


def _detect_repetitive_tapping_pattern(frames: List[str]) -> bool:
    """Detect actual repetitive tapping patterns using hand tracking, not just any movement."""
    if len(frames) < 4:  # Need at least 4 frames to detect patterns
        return False
    
    try:
        hand_positions = []
        
        # Track hand positions over time
        for f in frames:
            try:
                img = _decode_image(f)
                rgb = np.array(img)
                results = _mp_hands.process(rgb)
                
                if results.multi_hand_landmarks and len(results.multi_hand_landmarks) > 0:
                    # Get first hand's center position (average of all landmarks)
                    landmarks = results.multi_hand_landmarks[0].landmark
                    avg_x = np.mean([lm.x for lm in landmarks])
                    avg_y = np.mean([lm.y for lm in landmarks])
                    hand_positions.append((avg_x, avg_y))
                else:
                    hand_positions.append(None)  # No hand detected in this frame
            except Exception:
                hand_positions.append(None)
        
        # Filter out None positions and ensure we have enough valid positions
        valid_positions = [pos for pos in hand_positions if pos is not None]
        if len(valid_positions) < 3:
            print("Not enough valid hand positions for tapping pattern analysis", file=sys.stderr)
            return False
        
        # Calculate movement magnitudes between consecutive valid positions
        movements = []
        for i in range(len(valid_positions) - 1):
            x1, y1 = valid_positions[i]
            x2, y2 = valid_positions[i + 1]
            movement = np.sqrt((x2 - x1)**2 + (y2 - y1)**2)
            movements.append(movement)
        
        if len(movements) < 2:
            return False
        
        # Analyze movement pattern
        avg_movement = np.mean(movements)
        movement_std = np.std(movements)
        max_movement = max(movements)
        
        # Count significant movements (potential taps)
        significant_threshold = avg_movement + movement_std if movement_std > 0.001 else 0.01
        significant_movements = sum(1 for m in movements if m > significant_threshold)
        
        print(f"Tapping pattern analysis: avg_movement={avg_movement:.4f}, max={max_movement:.4f}, significant_movements={significant_movements}/{len(movements)}", file=sys.stderr)
        
        # Criteria for actual tapping:
        # 1. Must have multiple significant movements (at least 2)
        # 2. Maximum movement must be substantial (not just tiny shifts)
        # 3. At least 30% of movements should be significant (repetitive pattern)
        has_multiple_taps = significant_movements >= 2
        has_substantial_movement = max_movement > 0.015  # Reasonable threshold for intentional tapping
        has_repetitive_pattern = (significant_movements / len(movements)) >= 0.3
        
        detected = has_multiple_taps and has_substantial_movement and has_repetitive_pattern
        print(f"Tapping pattern result: {detected} (taps={has_multiple_taps}, substantial={has_substantial_movement}, repetitive={has_repetitive_pattern})", file=sys.stderr)
        
        return detected
        
    except Exception as e:
        print(f"Tapping pattern analysis error: {e}", file=sys.stderr)
        return False


def _predict(behavior: str, data: Any) -> Dict[str, Any]:
    """Run inference for a single behaviour and return unified JSON."""

    if behavior not in MODELS:
        return {"detected": False, "confidence": 0.0, "error": "unsupported_behavior"}

    model = MODELS[behavior].to(DEVICE)

    try:
        if behavior == "eye_gaze":
            if isinstance(data, dict):
                frames = data.get("frame_sequence") or data.get(behavior) or []
            else:
                frames = data

            crops = []
            for f in frames:
                try:
                    img = _decode_image(f)
                    eye = _eye_crop(img)
                    if eye is not None:
                        crops.append(_IMAGE_TF(eye))
                except Exception:
                    continue

            if len(crops) < 1:  # need at least one frame
                return {"detected": False, "confidence": 0.0, "error": "insufficient_eye_frames"}

            frames_tensor = torch.stack(crops, dim=0).unsqueeze(0).to(DEVICE)  # (1, T, C, H, W)
            logits = model(frames_tensor)  # shape (1, 5)

            probs = torch.softmax(logits, dim=1)[0]
            prob, idx = probs.max(dim=0)
            gaze_classes = ["down", "left", "right", "straight", "up"]
            label = gaze_classes[idx.item()] if idx < len(gaze_classes) else str(idx.item())

            return {
                "detected": True,
                "confidence": round(prob.item(), 4),
                "gaze": label,
            }

        elif behavior in ("tapping_hands", "tapping_feet"):
            if isinstance(data, dict):
                frames = data.get("frame_sequence") or data.get(behavior) or []
            else:
                frames = data

            crops = []
            for f in frames:
                try:
                    img = _decode_image(f)
                    crop_fn = _hand_crop if behavior == "tapping_hands" else _foot_crop
                    cimg = crop_fn(img)
                    if cimg is not None:
                        crops.append(_IMAGE_TF(cimg))
                except Exception:
                    continue

            if len(crops) < 1:  # Reduced to 1 frame required
                # For foot tapping, only use fallback if feet were detected but cropping failed
                if behavior == "tapping_feet":
                    # Check if any feet/ankles are actually visible in the frames
                    feet_detected_in_any_frame = False
                    for f in frames[:3]:  # Check first few frames for efficiency
                        try:
                            img = _decode_image(f)
                            rgb = np.array(img)
                            results = _mp_pose.process(rgb)
                            if results.pose_landmarks:
                                # Check if ankle landmarks are detected
                                ankles = [results.pose_landmarks.landmark[i] for i in (27, 28)]
                                if any(ankle.visibility > 0.5 for ankle in ankles):
                                    feet_detected_in_any_frame = True
                                    break
                        except Exception:
                            continue
                    
                    if feet_detected_in_any_frame:
                        # Feet are visible but cropping failed - use movement fallback
                        movement_detected = _simple_movement_analysis(frames)
                        confidence = 0.4 if movement_detected else 0.1
                        print(f"Foot tapping fallback (feet visible): detected={movement_detected}, confidence={confidence}", file=sys.stderr)
                        return {"detected": movement_detected, "confidence": confidence, "fallback": True}
                    else:
                        # No feet visible - don't detect foot tapping
                        print("No feet detected in any frame - returning no foot tapping detection", file=sys.stderr)
                        return {"detected": False, "confidence": 0.0, "error": "no_feet_visible"}
                
                # For hand tapping, only use fallback if hands are detected and showing repetitive patterns
                elif behavior == "tapping_hands":
                    # Check if hands are actually visible in the frames first
                    hands_detected_in_any_frame = False
                    for f in frames[:3]:  # Check first few frames for efficiency
                        try:
                            img = _decode_image(f)
                            rgb = np.array(img)
                            results = _mp_hands.process(rgb)
                            if results.multi_hand_landmarks and len(results.multi_hand_landmarks) > 0:
                                hands_detected_in_any_frame = True
                                break
                        except Exception:
                            continue
                    
                    if hands_detected_in_any_frame:
                        # Hands are visible - check for repetitive tapping patterns, not just any movement
                        tapping_detected = _detect_repetitive_tapping_pattern(frames)
                        if tapping_detected:
                            print(f"Hand tapping pattern fallback: detected={tapping_detected}", file=sys.stderr)
                            return {"detected": True, "confidence": 0.25, "fallback": True}
                        else:
                            print("Hands visible but no repetitive tapping pattern detected", file=sys.stderr)
                            return {"detected": False, "confidence": 0.05, "error": "no_tapping_pattern"}
                    else:
                        # No hands visible - don't detect hand tapping
                        print("No hands detected in any frame - returning no hand tapping detection", file=sys.stderr)
                        return {"detected": False, "confidence": 0.0, "error": "no_hands_visible"}
                return {"detected": False, "confidence": 0.0, "error": "insufficient_tapping_frames"}

            frames_tensor = torch.stack(crops, dim=0).unsqueeze(0).to(DEVICE)
            logits = model(frames_tensor)
            prob = torch.softmax(logits, dim=1)[0, 1].item()

        elif behavior == "sit_stand":
            # If provided as frames, extract pose landmarks; else assume already sequence
            if isinstance(data, list) and data and isinstance(data[0], str):
                # list of base64 images
                seq = []
                for f in data:
                    try:
                        img = _decode_image(f)
                        coords = _pose_xy(img)
                        if coords is not None:
                            seq.append(coords)
                    except Exception:
                        continue
                if len(seq) < 1:  # Reduced to 1 frame required
                    return {"detected": False, "confidence": 0.0, "error": "insufficient_pose_frames"}
            else:
                seq = data if isinstance(data, list) else data.get(behavior) or []

            seq_tensor = torch.tensor(seq, dtype=torch.float32)
            if seq_tensor.dim() == 1:
                seq_tensor = seq_tensor.unsqueeze(0)
            seq_tensor = seq_tensor.unsqueeze(0).to(DEVICE)
            logits = model(seq_tensor)
            prob = torch.softmax(logits, dim=1)[0, 1].item()

        elif behavior == "rapid_talking":
            seq = data if isinstance(data, list) else data.get(behavior) or []
            print(f"Rapid talking input data: {seq} (type: {type(seq)}, length: {len(seq) if hasattr(seq, '__len__') else 'N/A'})", file=sys.stderr)
            
            # Handle empty or invalid data
            if not seq or (isinstance(seq, list) and len(seq) == 0):
                print("No rapid talking data provided - returning low confidence detection", file=sys.stderr)
                return {"detected": False, "confidence": 0.1}
            
            # Ensure we have numerical data
            if isinstance(seq, list):
                try:
                    # Filter out non-numeric values and ensure we have valid WPM data
                    numeric_seq = [float(x) for x in seq if isinstance(x, (int, float)) and not np.isnan(float(x))]
                    if len(numeric_seq) == 0:
                        print("No valid numeric data in rapid talking sequence", file=sys.stderr)
                        return {"detected": False, "confidence": 0.1}
                    seq = numeric_seq
                    print(f"Processed rapid talking sequence: {seq} (avg: {np.mean(seq):.1f})", file=sys.stderr)
                except (ValueError, TypeError) as e:
                    print(f"Error processing rapid talking data: {e}", file=sys.stderr)
                    return {"detected": False, "confidence": 0.1}
            
            seq_tensor = torch.tensor(seq, dtype=torch.float32).view(1, -1, 1).to(DEVICE)
            prob = model(seq_tensor).squeeze().item()

        else:
            prob = 0.0

        prob = float(max(0.0, min(1.0, prob)))  # clamp to [0,1]
        return {"detected": prob > 0.2, "confidence": round(prob, 4)}

    except Exception as exc:
        # Fall back gracefully
        return {"detected": False, "confidence": 0.0, "error": str(exc)}


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Run ML analysis on behaviour data")
    parser.add_argument("--data", required=True, help="Path to JSON file containing input data")
    parser.add_argument("--behavior", required=True, help="Behavior type (e.g. eye_gaze)")

    args = parser.parse_args()

    if not os.path.exists(args.data):
        print(json.dumps({"error": f"Data file not found: {args.data}"}), file=sys.stderr)
        sys.exit(1)

    try:
        with open(args.data, "r", encoding="utf-8") as fp:
            payload = json.load(fp)
    except Exception as exc:
        print(json.dumps({"error": f"Failed to read input file: {exc}"}), file=sys.stderr)
        sys.exit(1)

    # Extract behaviour-specific data from payload; the controller wrapped it
    data = payload.get(args.behavior, payload)

    result = _predict(args.behavior, data)

    # Output **only** JSON on stdout so Node.js can parse it directly
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Ensure any unexpected errors are surfaced correctly to Node (stderr)
        print(str(e), file=sys.stderr)
        sys.exit(1) 