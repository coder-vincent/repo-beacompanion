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

# External deps -------------------------------------------------------------

# Local util that loads and caches models (and is rather chatty). We import it
# and *call* it with stdout/stderr fully captured so none of its diagnostic
# prints escape.
_silent = io.StringIO()
with contextlib.redirect_stdout(_silent), contextlib.redirect_stderr(_silent):
    from model_loader import load_model

# Global cache of lazily-loaded models (behaviour -> torch.nn.Module)
MODELS: dict[str, torch.nn.Module] = {}

# For eye gaze preprocessing -------------------------------------------------

import numpy as np

# Mediapipe emits many C++ backend INFO/WARNING messages on import. Capture
# stderr during import so those lines don't reach the parent process.
_mp_silent = io.StringIO()
with contextlib.redirect_stderr(_mp_silent):
    import mediapipe as mp  # type: ignore

# ---------------------------------------------------------------------------
# Logging / Verbosity configuration (must come before importing TensorFlow /
# Mediapipe so that these libs respect the settings).
# ---------------------------------------------------------------------------

# 1. Suppress TensorFlow / TF-Lite C++ backend INFO & WARNING messages.
#    0 = all logs, 1 = INFO, 2 = WARNING, 3 = ERROR
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")  # Show only errors

# 2. Silence Mediapipe & absl logging noise (e.g. XNNPACK delegate, feedback
#    tensors warnings) while keeping real errors visible.
try:
    from absl import logging as _absl_logging  # type: ignore

    _absl_logging.set_verbosity(_absl_logging.ERROR)
    _absl_logging.set_stderrthreshold(_absl_logging.ERROR)
except (ImportError, ModuleNotFoundError):
    # absl is a transitive dependency of mediapipe. If it isn't available,
    # continue – the worst case is slightly chattier logs.
    pass

# Standard Python logging for other noisy modules (including mediapipe).
import logging as _py_logging
_py_logging.getLogger("mediapipe").setLevel(_py_logging.ERROR)

# ---------------------------------------------------------------------------
# Runtime stderr filter — hides recurring INFO/WARNING spam emitted by the
# TFLite / Mediapipe C++ backend that isn't controllable via the usual
# TF_CPP_MIN_LOG_LEVEL or absl settings. Genuine error messages are still
# forwarded.
# ---------------------------------------------------------------------------

_SILENCE_PATTERNS = (
    "INFO: Created TensorFlow Lite XNNPACK delegate",  # TFLite delegate info
    "Feedback manager requires a model with a single signature inference",  # TFLite feedback warning
    "All log messages before absl::InitializeLog() is called",  # absl pre-init
    "Using NORM_RECT without IMAGE_DIMENSIONS is only supported",  # Mediapipe projection calc
)


class _StderrFilter(io.TextIOBase):
    """Intercept sys.stderr writes and drop lines matching noisy patterns."""

    def __init__(self, original):
        self._original = original

    def write(self, data):  # type: ignore[override]
        # Pass through everything that doesn't match a known noisy pattern.
        if any(pat in data for pat in _SILENCE_PATTERNS):
            return len(data)
        return self._original.write(data)

    def flush(self):  # type: ignore[override]
        return self._original.flush()


# Replace sys.stderr with the filtering wrapper **after** we've set up other
# redirections/logging tweaks so it only affects runtime emissions.
sys.stderr = _StderrFilter(sys.stderr)

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

# DEVICE available if needed (but models already loaded).

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
# MODELS already initialised in silenced block above.

# Common image transform (matches notebook training — 64×64 RGB, no normalisation)
IMAGE_SIZE = 64
_IMAGE_TF = transforms.Compose([
    transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
    transforms.ToTensor(),  # outputs [0,1] float32
])

# Mediapipe FaceMesh for eye region extraction
# type: ignore[attr-defined] is needed because the Mediapipe Python stubs do
# not currently expose the FaceMesh/Hands/Pose attributes, even though they
# exist at runtime.

with contextlib.redirect_stderr(_mp_silent):
    _mp_face_mesh = mp.solutions.face_mesh.FaceMesh(  # type: ignore[attr-defined]
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
# type: ignore[attr-defined] is needed because the Mediapipe Python stubs do
# not currently expose the FaceMesh/Hands/Pose attributes, even though they
# exist at runtime.

with contextlib.redirect_stderr(_mp_silent):
    _mp_hands = mp.solutions.hands.Hands(static_image_mode=True, max_num_hands=2)  # type: ignore[attr-defined]
    _mp_pose = mp.solutions.pose.Pose(static_image_mode=True)  # type: ignore[attr-defined]


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
    """Extract 33 (x,y) pose landmarks as flat list normalized to image size.

    Returns None if the **full body is not visible**, specifically when the key
    lower-body landmarks (hips, knees and ankles) are missing or have very low
    visibility (<0.3). This prevents false sit/stand detections when the camera
    frame does not capture the whole body.
    """
    rgb = np.array(img)
    res = _mp_pose.process(rgb)
    if not res.pose_landmarks:
        return None

    # Key indices for lower-body visibility check (left/right hip, knee, ankle)
    _LOWER_BODY_IDX = [23, 24, 25, 26, 27, 28]

    # Require that at least 4 of the 6 lower-body landmarks have reasonable
    # visibility (>0.3). This indicates that most of the body is in frame.
    visible_lower_body = sum(
        1 for i in _LOWER_BODY_IDX if res.pose_landmarks.landmark[i].visibility > 0.3
    )
    if visible_lower_body < 4:
        # Not enough of the body in view – skip this frame
        return None

    h, w, _ = rgb.shape
    coords: list[float] = []
    for lm in res.pose_landmarks.landmark:
        coords.extend([lm.x, lm.y])  # already normalized to [0,1]
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
        try:
            # Suppress verbose weight-loading prints so only explicit logs reach stderr
            with contextlib.redirect_stdout(_silent), contextlib.redirect_stderr(_silent):
                MODELS[behavior] = load_model(behavior)
        except Exception as exc:
            return {"detected": False, "confidence": 0.0, "error": "model_load_failed", "details": str(exc)}

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
            
            # -----------------------------------------------------------
            # Rule-based rapid talking detection (150+ WPM threshold)
            #   • avg WPM < 150   → confidence = 0.1 (not detected)
            #   • 150 ≤ avg WPM < 200 → confidence = 0.5 (detected)
            #   • avg WPM ≥ 200  → confidence = 1.0 (strongly detected)
            # -----------------------------------------------------------

            avg_wpm = np.mean(seq)
            print(f"Average WPM for rapid_talking: {avg_wpm:.1f}", file=sys.stderr)

            if avg_wpm < 150:
                prob = 0.1
                detected = False
            elif avg_wpm < 200:
                prob = 0.5
                detected = True
            else:  # >= 200 WPM
                prob = 1.0
                detected = True

            # Return immediately based on the rule-based threshold.
            return {"detected": detected, "confidence": round(prob, 4), "avg_wpm": round(avg_wpm, 2)}

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