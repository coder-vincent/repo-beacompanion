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

# Mediapipe Face Detection as fallback
_mp_face_detection = mp.solutions.face_detection.FaceDetection(
    model_selection=0,
    min_detection_confidence=0.3
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
    
    # Ensure minimum size for detection
    if img.size[0] < 100 or img.size[1] < 100:
        img = img.resize((640, 480), Image.Resampling.LANCZOS)

    rgb = np.array(img)  # PIL to numpy RGB
    results = _mp_face_mesh.process(rgb)
    if not results.multi_face_landmarks:
        # Try with face detection instead of face mesh
        face_results = _mp_face_detection.process(rgb)
        if not face_results.detections:
            return None
        # Use face detection bounding box for eye region
        detection = face_results.detections[0]
        bbox = detection.location_data.relative_bounding_box
        h, w, _ = rgb.shape
        x_min = int(bbox.xmin * w)
        y_min = int(bbox.ymin * h + bbox.height * h * 0.2)  # Upper part for eyes
        x_max = int((bbox.xmin + bbox.width) * w)
        y_max = int(bbox.ymin * h + bbox.height * h * 0.6)  # Middle part for eyes
    else:
        h, w, _ = rgb.shape
        xs, ys = [], []
        for lm_idx in _EYE_IDXS:
            lm = results.multi_face_landmarks[0].landmark[lm_idx]
            xs.append(lm.x * w)
            ys.append(lm.y * h)

        x_min, x_max = max(min(xs) - 20, 0), min(max(xs) + 20, w)
        y_min, y_max = max(min(ys) - 20, 0), min(max(ys) + 20, h)

    if x_max - x_min < 20 or y_max - y_min < 20:
        return None

    crop = rgb[int(y_min): int(y_max), int(x_min): int(x_max)]
    if crop.size == 0:
        return None
    crop_pil = Image.fromarray(crop)
    # Resize to consistent size for model
    crop_pil = crop_pil.resize((64, 64), Image.Resampling.LANCZOS)
    return crop_pil


def _hand_crop(img: Image.Image) -> Image.Image | None:
    """Return crop around first detected hand suitable for tapping models."""
    
    # Ensure minimum size for detection
    if img.size[0] < 200 or img.size[1] < 200:
        img = img.resize((640, 480), Image.Resampling.LANCZOS)

    rgb = np.array(img)
    results = _mp_hands.process(rgb)
    if not results.multi_hand_landmarks:
        return None

    h, w, _ = rgb.shape
    xs, ys = [], []
    for lm in results.multi_hand_landmarks[0].landmark:
        xs.append(lm.x * w)
        ys.append(lm.y * h)

    # Larger crop area for better detection
    x_min, x_max = max(min(xs) - 30, 0), min(max(xs) + 30, w)
    y_min, y_max = max(min(ys) - 30, 0), min(max(ys) + 30, h)
    if x_max - x_min < 30 or y_max - y_min < 30:
        return None
    crop = rgb[int(y_min): int(y_max), int(x_min): int(x_max)]
    if crop.size == 0:
        return None
    crop_pil = Image.fromarray(crop)
    # Resize to consistent size for model
    crop_pil = crop_pil.resize((224, 224), Image.Resampling.LANCZOS)
    return crop_pil


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


def _analyze_frame_movement(frames: List[str]) -> float:
    """Analyze frame sequence for movement/changes to generate realistic fallback confidence."""
    if len(frames) < 2:
        return 0.2
    
    try:
        # Convert first and last frames to analyze movement
        img1 = _decode_image(frames[0])
        img2 = _decode_image(frames[-1])
        
        # Convert to grayscale for comparison
        gray1 = img1.convert('L')
        gray2 = img2.convert('L')
        
        # Resize to consistent size for comparison
        gray1 = gray1.resize((100, 100))
        gray2 = gray2.resize((100, 100))
        
        # Calculate frame difference
        arr1 = np.array(gray1, dtype=np.float32)
        arr2 = np.array(gray2, dtype=np.float32)
        diff = np.mean(np.abs(arr1 - arr2)) / 255.0
        
        # Movement suggests potential behavior
        return min(1.0, diff * 2.0 + 0.1)
    except Exception:
        return 0.3  # Default moderate confidence


def _predict(behavior: str, data: Any) -> Dict[str, Any]:
    """Run inference for a single behaviour and return unified JSON."""

    if behavior not in MODELS:
        return {"detected": False, "confidence": 0.0, "error": "unsupported_behavior"}

    model = MODELS[behavior].to(DEVICE)
    print(f"Analyzing {behavior} with data type: {type(data)}", file=sys.stderr)
    if isinstance(data, list):
        print(f"Data is list with {len(data)} items", file=sys.stderr)
        if data and len(data) > 0:
            print(f"First item type: {type(data[0])}, length: {len(str(data[0])[:100])}", file=sys.stderr)
    elif isinstance(data, str):
        print(f"Data is string with length: {len(data)}", file=sys.stderr)
        print(f"First 100 chars: {data[:100]}", file=sys.stderr)
    elif isinstance(data, dict):
        print(f"Data is dict with keys: {list(data.keys())}", file=sys.stderr)

    try:
        if behavior == "eye_gaze":
            if isinstance(data, dict):
                frames = data.get("frame_sequence") or data.get(behavior) or []
            else:
                frames = data

            crops = []
            for i, f in enumerate(frames):
                try:
                    img = _decode_image(f)
                    eye = _eye_crop(img)
                    if eye is not None:
                        crops.append(_IMAGE_TF(eye))
                    else:
                        print(f"Frame {i}: No face detected in image", file=sys.stderr)
                except Exception as e:
                    print(f"Frame {i} failed: {type(e).__name__}: {str(e)}", file=sys.stderr)
                    continue

            if len(crops) < 2:  # need at least 2 frames
                print(f"Eye gaze: only {len(crops)} valid crops from {len(frames)} frames", file=sys.stderr)
                # Fallback: analyze frame movement/brightness for basic detection
                frame_analysis = _analyze_frame_movement(frames)
                confidence = max(0.15, min(0.45, frame_analysis * 0.4 + 0.15))
                return {"detected": confidence > 0.25, "confidence": round(confidence, 3), "gaze": "straight", "fallback": True}

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
            for i, f in enumerate(frames):
                try:
                    img = _decode_image(f)
                    crop_fn = _hand_crop if behavior == "tapping_hands" else _foot_crop
                    cimg = crop_fn(img)
                    if cimg is not None:
                        crops.append(_IMAGE_TF(cimg))
                    else:
                        detection_type = "hands" if behavior == "tapping_hands" else "feet/pose"
                        print(f"Frame {i}: No {detection_type} detected in image", file=sys.stderr)
                except Exception as e:
                    print(f"Frame {i} failed: {type(e).__name__}: {str(e)}", file=sys.stderr)
                    continue

            if len(crops) < 2:
                print(f"{behavior}: only {len(crops)} valid crops from {len(frames)} frames", file=sys.stderr)
                # Fallback: analyze frame movement for tapping detection
                frame_analysis = _analyze_frame_movement(frames)
                confidence = max(0.2, min(0.5, frame_analysis * 0.5 + 0.2))
                return {"detected": confidence > 0.3, "confidence": round(confidence, 3), "fallback": True}

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
                if len(seq) < 2:
                    print(f"Sit/stand: only {len(seq)} valid poses from frames", file=sys.stderr)
                    # Fallback: analyze frame movement for posture changes
                    frame_analysis = _analyze_frame_movement(data)
                    confidence = max(0.15, min(0.4, frame_analysis * 0.3 + 0.15))
                    return {"detected": confidence > 0.25, "confidence": round(confidence, 3), "fallback": True}
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
            seq_tensor = torch.tensor(seq, dtype=torch.float32).view(1, -1, 1).to(DEVICE)
            prob = model(seq_tensor).squeeze().item()

        else:
            prob = 0.0

        prob = float(max(0.0, min(1.0, prob)))  # clamp to [0,1]
        return {"detected": prob > 0.3, "confidence": round(prob, 4)}

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
        error_msg = f"Data file not found: {args.data}"
        print(error_msg, file=sys.stderr)
        fallback_result = {"detected": False, "confidence": 0.0, "error": error_msg, "fallback": True}
        sys.stdout.write(json.dumps(fallback_result))
        return

    try:
        with open(args.data, "r", encoding="utf-8") as fp:
            payload = json.load(fp)
    except Exception as exc:
        error_msg = f"Failed to read input file: {exc}"
        print(error_msg, file=sys.stderr)
        fallback_result = {"detected": False, "confidence": 0.0, "error": error_msg, "fallback": True}
        sys.stdout.write(json.dumps(fallback_result))
        return

    # Extract behaviour-specific data from payload; the controller wrapped it
    data = payload.get(args.behavior, payload)

    try:
        result = _predict(args.behavior, data)
        
        # Ensure result is valid JSON serializable
        if not isinstance(result, dict):
            result = {"detected": False, "confidence": 0.0, "error": "Invalid result format", "fallback": True}
            
    except Exception as exc:
        print(f"Prediction error: {str(exc)}", file=sys.stderr)
        result = {"detected": False, "confidence": 0.0, "error": str(exc), "fallback": True}

    # Output **only** JSON on stdout so Node.js can parse it directly
    try:
        sys.stdout.write(json.dumps(result))
        sys.stdout.flush()
    except Exception as exc:
        print(f"JSON output error: {str(exc)}", file=sys.stderr)
        # Final fallback - simple JSON that should always work
        simple_result = '{"detected": false, "confidence": 0.0, "error": "JSON serialization failed", "fallback": true}'
        sys.stdout.write(simple_result)
        sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
        # Always exit with code 0 if main() completes
        sys.exit(0)
    except Exception as e:
        # Ensure any unexpected errors are surfaced correctly to Node (stderr)
        print(f"Fatal error: {str(e)}", file=sys.stderr)
        # Output a fallback JSON result even on fatal error
        fallback_result = {"detected": False, "confidence": 0.0, "error": str(e), "fallback": True}
        sys.stdout.write(json.dumps(fallback_result))
        sys.exit(0)  # Exit successfully with fallback result