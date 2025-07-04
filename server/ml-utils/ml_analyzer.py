# pyright: reportAttributeAccessIssue=false, reportGeneralTypeIssues=false, reportOptionalMemberAccess=false, reportMissingImports=false, reportOperatorIssue=false, reportUnknownArgumentType=false, reportUnknownMemberType=false
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
from typing import Any, Dict, List, Union
from pathlib import Path

# Silence any prints while importing model_loader to keep stdout clean
import contextlib
import io

# Safe import torch – fallback if not available (Render slug without torch)
try:
    import torch  # type: ignore
    TORCH_AVAILABLE = True
except ImportError:
    print("Warning: PyTorch not available – ML models will be disabled", file=sys.stderr)
    TORCH_AVAILABLE = False

# If torch missing, create a lightweight stub so runtime imports succeed
from typing import Any

if not TORCH_AVAILABLE:
    class _TorchStub:
        def __getattr__(self, name: str) -> Any:  # noqa: D401,E501
            def _missing(*args: Any, **kwargs: Any) -> None:  # noqa: D401,E501
                raise ImportError("PyTorch is required for ML inference but is not installed in this environment.")

            return _missing

    torch = _TorchStub()  # type: ignore[name-defined, assignment]

# ---------------------------------------------------------------------------
# Device setup (safe if torch missing)
# ---------------------------------------------------------------------------

try:
    DEVICE = torch.device("cuda" if TORCH_AVAILABLE and torch.cuda.is_available() else "cpu")  # type: ignore[attr-defined]
except Exception:
    DEVICE = "cpu"  # Fallback when torch is stubbed

from PIL import Image
from torchvision import transforms

# Local util that loads and caches models (only if torch is available)
if TORCH_AVAILABLE:
    _silent = io.StringIO()
    with contextlib.redirect_stdout(_silent):
        from model_loader import load_all_models

    # Load *once* so subsequent calls are fast
    MODELS = load_all_models()
else:
    MODELS = {"rapid_talking": None}  # Only rule-based behaviors available

# For eye gaze preprocessing
import numpy as np
import mediapipe as mp

# State tracking file for sit-stand detection
SIT_STAND_STATE_FILE = Path(__file__).parent / "sit_stand_state.json"

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------


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
    min_detection_confidence=0.3,  # Lower confidence for better detection
    min_tracking_confidence=0.3
)

# Mediapipe Face Detection as fallback
_mp_face_detection = mp.solutions.face_detection.FaceDetection(
    model_selection=0,
    min_detection_confidence=0.2  # Lower confidence for better detection
)

# Landmarks indices around both eyes (approx.)
_EYE_IDXS = [
    33, 246, 161, 160, 159, 158, 157, 173, 133, 7, 163, 144, 145, 153,
    362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380
]

# MediaPipe Hands and Pose instances with very low confidence thresholds for webcam scenarios
_mp_hands = mp.solutions.hands.Hands(
    static_image_mode=True, 
    max_num_hands=2,
    min_detection_confidence=0.1,  # Very low for webcam scenarios
    min_tracking_confidence=0.1
)
_mp_pose = mp.solutions.pose.Pose(
    static_image_mode=True,
    min_detection_confidence=0.1,  # Very low for webcam scenarios
    min_tracking_confidence=0.1,
    model_complexity=1  # Use more robust model
)


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


def _frames_to_tensor(frames: List[str]) -> Any:
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
    """Return crop around eye region suitable for eye gaze model."""
    # Enhanced preprocessing for better detection
    img = _enhance_image_for_detection(img)

    rgb = np.array(img)  # PIL to numpy RGB
    results = _mp_face_mesh.process(rgb)
    if not results.multi_face_landmarks:
        # Try with face detection instead of face mesh
        face_results = _mp_face_detection.process(rgb)
        if not face_results.detections:
            print(f"MediaPipe face: No face detected in {img.size} image", file=sys.stderr)
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

        x_min, x_max = max(min(xs) - 30, 0), min(max(xs) + 30, w)  # Increased crop area
        y_min, y_max = max(min(ys) - 30, 0), min(max(ys) + 30, h)  # Increased crop area

    if x_max - x_min < 30 or y_max - y_min < 30:  # Increased minimum size
        print(f"Eye crop too small: {x_max-x_min}x{y_max-y_min}", file=sys.stderr)
        return None

    crop = rgb[int(y_min): int(y_max), int(x_min): int(x_max)]
    if crop.size == 0:
        return None
    crop_pil = Image.fromarray(crop)
    # Resize to consistent size for model
    crop_pil = crop_pil.resize((64, 64), Image.Resampling.LANCZOS)
    return crop_pil


def _enhance_image_for_detection(img: Image.Image) -> Image.Image:
    """Enhance image quality for better MediaPipe detection."""
    # Ensure sufficient resolution
    if img.size[0] < 480 or img.size[1] < 360:
        img = img.resize((640, 480), Image.Resampling.LANCZOS)
    
    # Convert to RGB if needed
    if img.mode != 'RGB':
        img = img.convert('RGB')
    
    return img


def _analyze_hand_tapping_patterns(hand_positions, frames):
    """
    STRICT hand tapping analysis - detects only actual repetitive tapping patterns:
    1. Requires hands to be visible with decent confidence
    2. Analyzes for repetitive movement patterns (not just any movement)
    3. Requires multiple significant movements to qualify as tapping
    """
    print(f"Analyzing {len(frames)} frames for ACTUAL hand tapping patterns (strict mode)...", file=sys.stderr)
    
    tapping_score = 0.0
    clapping_score = 0.0
    tap_count = 0
    clap_count = 0
    
    # Try MediaPipe hand detection with REASONABLE confidence
    try:
        import mediapipe as mp
        mp_hands = mp.solutions.hands
        mp_drawing = mp.solutions.drawing_utils
        
        # REASONABLE hand detection settings - not ultra-sensitive
        hands = mp_hands.Hands(
            static_image_mode=True,
            max_num_hands=2,
            min_detection_confidence=0.6,  # Reasonable confidence
            min_tracking_confidence=0.5    # Reasonable tracking
        )
        
        print(f"MediaPipe hand detection with REASONABLE confidence (0.6)...", file=sys.stderr)
        
        enhanced_hand_positions = []
        
        for frame_idx, frame_data in enumerate(frames):
            try:
                # Decode frame
                import base64
                import cv2
                import numpy as np
                
                frame_bytes = base64.b64decode(frame_data.split(',')[1])
                frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
                frame = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                
                # Try hand detection with reasonable confidence
                results = hands.process(frame_rgb)
                frame_hands = []
                
                if results.multi_hand_landmarks:
                    for hand_landmarks in results.multi_hand_landmarks:
                        # Verify this is actually a good quality hand detection
                        landmark_confidences = [lm.visibility for lm in hand_landmarks.landmark if hasattr(lm, 'visibility')]
                        if landmark_confidences and np.mean(landmark_confidences) > 0.7:  # High quality detection only
                            # Get hand center
                            x_coords = [lm.x for lm in hand_landmarks.landmark]
                            y_coords = [lm.y for lm in hand_landmarks.landmark]
                            center_x = sum(x_coords) / len(x_coords) * frame.shape[1]
                            center_y = sum(y_coords) / len(y_coords) * frame.shape[0]

                            # Only keep hands roughly in front of torso (below ~30% frame height). This avoids raising when waving near head.
                            if center_y > frame.shape[0] * 0.3:
                                frame_hands.append((center_x, center_y))
                                print(
                                    f"Frame {frame_idx}: High-quality hand accepted for tap analysis (avg conf {np.mean(landmark_confidences):.2f}, y={center_y:.0f})",
                                    file=sys.stderr,
                                )
                            else:
                                print(
                                    f"Frame {frame_idx}: Hand above torso – ignored for tap analysis (y={center_y:.0f})",
                                    file=sys.stderr,
                                )
                            print(f"Frame {frame_idx}: High-quality hand detected (avg confidence: {np.mean(landmark_confidences):.2f})", file=sys.stderr)
                        else:
                            print(f"Frame {frame_idx}: Low-quality hand detection rejected", file=sys.stderr)
                else:
                    print(f"Frame {frame_idx}: No hands detected with reasonable confidence", file=sys.stderr)
                
                enhanced_hand_positions.append(frame_hands)
                
            except Exception as e:
                print(f"Frame {frame_idx} processing error: {e}", file=sys.stderr)
                enhanced_hand_positions.append([])
        
        # Use enhanced positions if we got any HIGH-QUALITY hands
        if any(len(frame_hands) > 0 for frame_hands in enhanced_hand_positions):
            hand_positions = enhanced_hand_positions
            print(f"Using high-quality MediaPipe detection with {sum(len(f) for f in hand_positions)} total hand detections", file=sys.stderr)
        else:
            print(f"No high-quality hands detected - SKIPPING movement-based fallback to prevent false positives", file=sys.stderr)
            # NO FALLBACK to movement detection - if no good hands, return no detection
            return {
                'detected': False,
                'confidence': 0.0,
                'pattern': "no_hands_detected",
                'tap_count': 0,
                'clap_count': 0,
                'tapping_score': 0.0,
                'clapping_score': 0.0,
                'analysis_type': 'no_hands_early_exit'
            }
            
    except Exception as e:
        print(f"MediaPipe enhancement failed: {e}", file=sys.stderr)
    
    # METHOD 1: SMART MOVEMENT DETECTION (detects actual tapping motion)
    movement_taps = 0
    movement_score = 0.0
    
    if len(frames) >= 2:
        try:
            import base64
            import cv2
            import numpy as np
            
            print(f"Starting SMART movement analysis (detects actual tapping motion)...", file=sys.stderr)
            
            total_frame_diff = 0
            valid_comparisons = 0
            
            for frame_idx in range(1, len(frames)):
                try:
                    # Decode current and previous frames
                    curr_frame_bytes = base64.b64decode(frames[frame_idx].split(',')[1])
                    prev_frame_bytes = base64.b64decode(frames[frame_idx-1].split(',')[1])
                    
                    curr_array = np.frombuffer(curr_frame_bytes, dtype=np.uint8)
                    prev_array = np.frombuffer(prev_frame_bytes, dtype=np.uint8)
                    
                    curr_frame = cv2.imdecode(curr_array, cv2.IMREAD_COLOR)
                    prev_frame = cv2.imdecode(prev_array, cv2.IMREAD_COLOR)
                    
                    if curr_frame is not None and prev_frame is not None:
                        # Convert to grayscale for simpler comparison
                        curr_gray = cv2.cvtColor(curr_frame, cv2.COLOR_BGR2GRAY)
                        prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
                        
                        # Resize to same size if needed
                        if curr_gray.shape != prev_gray.shape:
                            h, w = min(curr_gray.shape[0], prev_gray.shape[0]), min(curr_gray.shape[1], prev_gray.shape[1])
                            curr_gray = cv2.resize(curr_gray, (w, h))
                            prev_gray = cv2.resize(prev_gray, (w, h))
                        
                        # Calculate simple frame difference
                        diff = cv2.absdiff(curr_gray, prev_gray)
                        
                        # Ensure numpy ndarray for type-checker clarity
                        diff_np = np.asarray(diff)
                        
                        # EXTREMELY PERMISSIVE: Count any pixels that changed by more than 10
                        changed_pixels = int(np.sum(diff_np > 10))  # Very low threshold  # type: ignore[operator]
                        total_pixels = diff_np.size
                        change_ratio = changed_pixels / total_pixels
                        
                        # Average intensity of changes
                        avg_intensity = float(np.mean(diff_np))  # type: ignore[arg-type]
                        
                        # Combined movement score
                        frame_movement = change_ratio * 0.7 + (avg_intensity / 255) * 0.3
                        total_frame_diff += frame_movement
                        valid_comparisons += 1
                        
                        print(f"Frame {frame_idx}: changed_pixels={changed_pixels}, change_ratio={change_ratio:.4f}, avg_intensity={avg_intensity:.1f}, movement={frame_movement:.4f}", file=sys.stderr)
                        
                        # STRICT: Only detect significant intentional movements
                        if change_ratio > 0.12 and avg_intensity > 50:  # Raised thresholds
                            movement_taps += 1
                            print(f"Frame {frame_idx}: SIGNIFICANT TAPPING MOTION DETECTED! (change_ratio={change_ratio:.4f}, avg_intensity={avg_intensity:.1f})", file=sys.stderr)
                    
                except Exception as e:
                    print(f"Frame {frame_idx} comparison error: {e}", file=sys.stderr)
                    continue
            
            # Calculate overall movement with STRICT requirements
            if valid_comparisons > 0:
                avg_movement = total_frame_diff / valid_comparisons
                
                # STRICT SCORING: Require multiple significant movements for tapping detection
                if movement_taps >= 5 and avg_movement > 0.03:  # Need at least 5 taps AND larger movement
                    movement_score = min(0.6, max(0.3, avg_movement * 20 + movement_taps * 0.1))
                    print(f"REPETITIVE TAPPING DETECTED! avg_movement={avg_movement:.6f}, movement_taps={movement_taps}, score={movement_score:.3f}", file=sys.stderr)
                else:
                    print(f"No repetitive tapping pattern: avg_movement={avg_movement:.6f}, movement_taps={movement_taps} (need 5+ taps)", file=sys.stderr)
            else:
                print(f"No valid frame comparisons possible", file=sys.stderr)
                
        except Exception as e:
            print(f"Smart movement detection failed: {e}", file=sys.stderr)
    
    # If we detected movement, use it regardless of hand detection
    if movement_score > 0:
        tapping_score = max(tapping_score, movement_score)
        tap_count = max(tap_count, movement_taps, 1)  # At least 1 tap if movement detected
    
    # METHOD 2: Original MediaPipe hand analysis (if any hands detected)
    if any(len(frame_hands) > 0 for frame_hands in hand_positions):
        print(f"Running MediaPipe hand analysis on {sum(len(f) for f in hand_positions)} hand detections...", file=sys.stderr)
        
        # Original hand analysis code with lower thresholds
        if len(hand_positions) >= 2:
            for hand_idx in range(2):
                position_history = []
                
                for frame_hands in hand_positions:
                    if len(frame_hands) > hand_idx:
                        position_history.append(frame_hands[hand_idx])
                
                if len(position_history) >= 2:
                    y_positions = [pos[1] for pos in position_history]
                    x_positions = [pos[0] for pos in position_history]
                    
                    total_movement = 0
                    individual_taps = 0
                    
                    for i in range(1, len(y_positions)):
                        y_movement = abs(y_positions[i] - y_positions[i-1])
                        x_movement = abs(x_positions[i] - x_positions[i-1])
                        frame_movement = (y_movement**2 + x_movement**2)**0.5
                        total_movement += frame_movement
                        
                        if frame_movement > 15:  # Much higher threshold - require substantial movement
                            individual_taps += 1
                            print(f"Hand tap motion detected at frame {i}: movement={frame_movement:.1f}px", file=sys.stderr)
                    
                    avg_movement = total_movement / max(1, len(y_positions) - 1)
                    
                    # STRICT: Need multiple taps AND significant average movement
                    if avg_movement > 10 and individual_taps >= 3:  # Much higher thresholds
                        tapping_score = max(tapping_score, min(0.6, avg_movement * 0.05 + individual_taps * 0.15))
                        tap_count = max(tap_count, max(1, individual_taps))
                        print(f"Hand {hand_idx}: MediaPipe repetitive tapping detected - movements={individual_taps}, avg_movement={avg_movement:.1f}, score={tapping_score:.3f}", file=sys.stderr)
                    else:
                        print(f"Hand {hand_idx}: Not enough tapping activity - movements={individual_taps}, avg_movement={avg_movement:.1f} (need 3+ taps, avg>10)", file=sys.stderr)
    
    # METHOD 3: Clap detection (if 2+ hands detected)
    clap_distances = []
    
    for frame_hands in hand_positions:
        if len(frame_hands) >= 2:
            hand1, hand2 = frame_hands[0], frame_hands[1]
            distance = ((hand1[0] - hand2[0])**2 + (hand1[1] - hand2[1])**2)**0.5
            clap_distances.append(distance)
    
    if len(clap_distances) >= 2:
        min_distance = min(clap_distances)
        max_distance = max(clap_distances)
        distance_range = max_distance - min_distance
        
        clap_events = sum(1 for d in clap_distances if d < 120)  # Slightly more permissive
        
        if distance_range > 40 and min_distance < 80:  # Much higher thresholds for actual clapping
            clap_count = max(1, clap_events // 3)  # More conservative clap counting
            clapping_score = min(0.6, distance_range * 0.02 + clap_count * 0.3)
            print(f"Clapping detected - distance_range={distance_range:.1f}, min_dist={min_distance:.1f}, claps={clap_count}, score={clapping_score:.3f}", file=sys.stderr)
    
    # Combine all detection methods
    final_score = max(tapping_score, clapping_score)
    final_tap_count = max(tap_count, movement_taps, 1 if final_score > 0.4 else 0)  # Higher threshold for reporting
    
    # STRICT Pattern determination - higher thresholds
    if clapping_score > tapping_score and clap_count > 0 and clapping_score > 0.4:
        pattern = "clapping"
        confidence = clapping_score
        count = clap_count
    elif final_score > 0.4:  # Much higher threshold - only detect clear tapping
        pattern = "tapping"
        confidence = final_score
        count = final_tap_count
    else:
        pattern = "none"
        confidence = 0.0
        count = 0
    
    print(f"FINAL TAPPING ANALYSIS (STRICT): pattern={pattern}, confidence={confidence:.3f}, count={count}", file=sys.stderr)
    
    # ULTRA-STRICT: Require VERY clear evidence of intentional tapping
    # Only detect if we have substantial evidence from multiple methods
    ultra_strict_detected = False
    ultra_strict_confidence = 0.0
    
    if pattern != "none":
        # Must have BOTH high confidence AND multiple detection methods agreeing
        methods_detected = 0
        if movement_taps >= 6:  # Require **at least 6** movement-based tap indications
            methods_detected += 1
        if tap_count >= 5:  # Require **at least 5** MediaPipe-based taps
            methods_detected += 1
        if confidence > 0.65:  # Raise required confidence slightly
            methods_detected += 1

        # Additional safeguard – insist on **minimum total taps** (movement or landmark) before allowing detection
        min_total_taps = max(movement_taps, tap_count)

        if methods_detected >= 2 and confidence > 0.6 and min_total_taps >= 5:
            ultra_strict_detected = True
            ultra_strict_confidence = confidence
        else:
            print(
                f"ULTRA-STRICT REJECTION: methods_detected={methods_detected}, confidence={confidence:.3f}, total_taps={min_total_taps} (need ≥2 methods, ≥0.6 conf, ≥5 taps)",
                file=sys.stderr,
            )
    
    return {
        'detected': ultra_strict_detected,  # Extremely conservative detection
        'confidence': ultra_strict_confidence,
        'pattern': pattern if ultra_strict_detected else "none",
        'tap_count': count if ultra_strict_detected else 0,
        'clap_count': clap_count if ultra_strict_detected else 0,
        'tapping_score': tapping_score,
        'clapping_score': clapping_score,
        'analysis_type': 'ultra_strict_multi_method_validation'
    }


def _hand_crop(img: Image.Image) -> Image.Image | None:
    """Return crop around first detected hand suitable for tapping models."""
    
    # Enhanced preprocessing for better detection
    img = _enhance_image_for_detection(img)

    rgb = np.array(img)
    results = _mp_hands.process(rgb)
    
    # If no hand landmarks, try to detect any motion in upper body area (hands might be partially visible)
    if not results.multi_hand_landmarks:
        print(f"MediaPipe hands: No landmarks detected in {img.size} image", file=sys.stderr)
        
        # MUCH MORE CONSERVATIVE: Only use upper body if there's significant hand-like movement
        h, w, _ = rgb.shape
        # Focus on hand-likely areas only (sides of upper body where hands typically are)
        x_min, x_max = int(w * 0.1), int(w * 0.4)  # Left side only for hand movement
        y_min, y_max = int(h * 0.4), int(h * 0.7)   # Mid-torso area where hands operate
        
        crop = rgb[y_min:y_max, x_min:x_max]
        if crop.size > 0:
            # Much stricter content validation - require significant variation AND edge content
            crop_gray = np.mean(crop, axis=2)
            variation = np.std(crop_gray)
            
            # Check for edge content (hands/fingers create more edges)
            edges = np.abs(np.gradient(crop_gray)).mean()
            
            # VERY strict thresholds - only proceed if it looks like actual hand movement
            if variation > 35 and edges > 8:  # Much higher thresholds
                crop_pil = Image.fromarray(crop)
                crop_pil = crop_pil.resize((224, 224), Image.Resampling.LANCZOS)
                print(f"Using hand-specific area for detection (var={variation:.1f}, edges={edges:.1f}): {crop.shape}", file=sys.stderr)
                return crop_pil
            else:
                print(f"Upper body area insufficient for hand detection (var={variation:.1f}, edges={edges:.1f})", file=sys.stderr)
        
        return None

    h, w, _ = rgb.shape
    xs, ys = [], []
    for lm in results.multi_hand_landmarks[0].landmark:
        xs.append(lm.x * w)
        ys.append(lm.y * h)

    # Larger crop area for better detection
    x_min, x_max = max(min(xs) - 80, 0), min(max(xs) + 80, w)  # Even larger crop area
    y_min, y_max = max(min(ys) - 80, 0), min(max(ys) + 80, h)  # Even larger crop area
    
    if x_max - x_min < 40 or y_max - y_min < 40:
        print(f"Hand crop too small: {x_max-x_min}x{y_max-y_min}, using full upper area", file=sys.stderr)
        # Fallback to upper body area
        x_min, x_max = int(w * 0.1), int(w * 0.9)
        y_min, y_max = int(h * 0.2), int(h * 0.8)
    
    crop = rgb[int(y_min): int(y_max), int(x_min): int(x_max)]
    if crop.size == 0:
        return None
    crop_pil = Image.fromarray(crop)
    # Resize to consistent size for model
    crop_pil = crop_pil.resize((224, 224), Image.Resampling.LANCZOS)
    return crop_pil


def _foot_crop(img: Image.Image) -> Image.Image | None:
    """Return crop around feet region using Pose landmarks (ankles)."""

    # Enhanced preprocessing for better detection
    img = _enhance_image_for_detection(img)
    
    rgb = np.array(img)
    results = _mp_pose.process(rgb)
    
    if not results.pose_landmarks:
        print(f"MediaPipe pose: No landmarks detected in {img.size} image", file=sys.stderr)
        # DO NOT use fallback crops - no pose means no foot detection possible
        # This will force the system to use movement analysis instead of PyTorch model
        return None

    h, w, _ = rgb.shape
    # Try to get any visible lower body landmarks (ankles, knees, hips)
    lower_body_indices = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]  # hips, knees, ankles, feet
    visible_landmarks = []
    
    for idx in lower_body_indices:
        landmark = results.pose_landmarks.landmark[idx]
        if landmark.visibility > 0.3:  # Lower visibility threshold
            visible_landmarks.append(landmark)
    
    if len(visible_landmarks) < 1:
        print(f"No visible lower body landmarks detected", file=sys.stderr)
        # DO NOT use fallback crops - no feet visible means no detection possible
        # This will force the system to use movement analysis instead of PyTorch model
        return None
        
    # Use all visible lower body landmarks for crop area
    xs = [lm.x * w for lm in visible_landmarks]
    ys = [lm.y * h for lm in visible_landmarks]
         
    x_min, x_max = max(min(xs) - 60, 0), min(max(xs) + 60, w)  # Large crop area
    y_min, y_max = max(min(ys) - 60, 0), min(max(ys) + 60, h)  # Large crop area
    
    if x_max - x_min < 30 or y_max - y_min < 30:
        print(f"Lower body crop too small: {x_max-x_min}x{y_max-y_min}", file=sys.stderr)
        # Use wider area
        x_min, x_max = int(w * 0.1), int(w * 0.9)
        y_min, y_max = max(int(min(ys) - 60), 0), h
    
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
        return 0.1  # Lower baseline
    
    try:
        # Analyze multiple frame pairs for better movement detection
        movement_scores = []
        
        for i in range(0, len(frames) - 1, 2):  # Compare every other frame
            img1 = _decode_image(frames[i])
            img2 = _decode_image(frames[i + 1])
            
            # Convert to grayscale for comparison
            gray1 = img1.convert('L')
            gray2 = img2.convert('L')
            
            # Resize to consistent size for comparison
            gray1 = gray1.resize((100, 100))
            gray2 = gray2.resize((100, 100))
            
            # Calculate frame difference
            arr1 = np.array(gray1, dtype=np.float32)
            arr2 = np.array(gray2, dtype=np.float32)
            
            # Overall movement
            diff = float(np.mean(np.abs(arr1 - arr2)) / 255.0)
            
            # Check for high-motion areas (potential behavior movement) - balanced threshold
            motion_threshold = 35.0  # Balanced threshold for movement detection
            motion_mask = np.abs(arr1 - arr2) > motion_threshold
            motion_ratio = float(np.sum(motion_mask) / motion_mask.size)
            
            # Consider reasonable motion
            if motion_ratio < 0.03:  # Less than 3% of image changed significantly
                frame_score = diff * 0.4  # Moderate penalty for small movements
            else:
                frame_score = (diff * 0.6) + (motion_ratio * 0.4)
            
            movement_scores.append(frame_score)
        
        if not movement_scores:
            return 0.1
        
        # Use maximum movement score but with stricter requirements
        max_movement = max(movement_scores)
        avg_movement = sum(movement_scores) / len(movement_scores)
        
        # Balanced scoring for movement detection
        combined_score = (max_movement * 0.7) + (avg_movement * 0.3)
        
        # Reasonable movement requirements
        if combined_score < 0.05:  # Very low movement = no detection
            confidence = 0.1
        elif combined_score < 0.1:  # Low movement = low confidence
            confidence = 0.2
        else:
            # Scale to reasonable confidence range
            confidence = float(min(0.7, combined_score * 3.0 + 0.15))  # More reasonable multiplier
        
        print(f"Movement analysis: max={max_movement:.3f}, avg={avg_movement:.3f}, combined={combined_score:.3f}, final={confidence:.3f}", file=sys.stderr)
        
        return confidence
        
    except Exception as e:
        print(f"Movement analysis error: {e}", file=sys.stderr)
        return 0.1  # Lower default


def _analyze_foot_tapping_patterns(frames):
    """
    STRICT foot tapping analysis - detects only actual repetitive foot tapping patterns:
    1. Requires feet/ankles to be visible with decent confidence
    2. Analyzes for repetitive movement patterns in foot area (not just any movement)
    3. Requires multiple significant movements to qualify as foot tapping
    """
    print(f"Analyzing {len(frames)} frames for ACTUAL foot tapping patterns (strict mode)...", file=sys.stderr)
    
    # Try MediaPipe pose detection with REASONABLE confidence
    try:
        import mediapipe as mp
        mp_pose = mp.solutions.pose
        
        # REASONABLE pose detection settings
        pose = mp_pose.Pose(
            static_image_mode=True,
            model_complexity=1,
            min_detection_confidence=0.6,  # Reasonable confidence
            min_tracking_confidence=0.5    # Reasonable tracking
        )
        
        print(f"MediaPipe pose detection for feet/ankles with REASONABLE confidence (0.6)...", file=sys.stderr)
        
        foot_positions = []
        rel_y_list = []      # normalized ankle y positions (ankles)
        shoulder_y_list = [] # normalized shoulder y positions
        qualified_shoulder_frames = 0
        qualified_ankle_frames = 0
        qualified_fullbody_frames = 0  # frames where shoulders, hips, and ankles satisfy conditions
        
        hip_y_list = []  # for body span check
        
        for frame_idx, frame_data in enumerate(frames):
            try:
                # Decode frame
                import base64
                import cv2
                import numpy as np
                
                frame_bytes = base64.b64decode(frame_data.split(',')[1])
                frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
                frame = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                
                # Try pose detection
                results = pose.process(frame_rgb)
                frame_feet = []
                
                if results.pose_landmarks:
                    # Check ankle landmarks (27=left ankle, 28=right ankle)
                    landmarks = results.pose_landmarks.landmark
                    ankle_landmarks = [landmarks[27], landmarks[28]]  # type: ignore[index]
                    shoulder_landmarks = [landmarks[11], landmarks[12]]
                    
                    ankles_visible = 0
                    for ankle_idx, ankle in enumerate(ankle_landmarks):
                        # Accept only ankles that are clearly in the lower half of the frame (y > 0.5)
                        if ankle.visibility > 0.75 and ankle.y > 0.8:
                            foot_x = ankle.x * frame.shape[1]
                            foot_y = ankle.y * frame.shape[0]
                            frame_feet.append((foot_x, foot_y))
                            print(f"Frame {frame_idx}: High-quality {['left', 'right'][ankle_idx]} ankle detected (confidence: {ankle.visibility:.2f})", file=sys.stderr)
                            rel_y_list.append(ankle.y)
                            ankles_visible += 1
                        else:
                            print(f"Frame {frame_idx}: Low-quality {['left', 'right'][ankle_idx]} ankle detection rejected", file=sys.stderr)

                    # Record shoulders for body-span check when both shoulders visible
                    shoulder_vis = 0
                    for sh_idx, sh in enumerate(shoulder_landmarks):
                        if sh.visibility > 0.7 and sh.y < 0.35:
                            shoulder_y_list.append(sh.y)
                            shoulder_vis += 1

                    if shoulder_vis == 2:
                        qualified_shoulder_frames += 1
                    if ankles_visible == 2:
                        qualified_ankle_frames += 1

                    hip_landmarks = [landmarks[23], landmarks[24]]  # type: ignore[index]

                    hips_visible = 0
                    for hip in hip_landmarks:
                        if hip.visibility > 0.75 and hip.y > 0.55 and hip.y < 0.8:
                            hip_y_list.append(hip.y)
                            hips_visible += 1

                    # Determine if this frame shows full body (shoulders near top, hips mid, ankles bottom)
                    if shoulder_vis == 2 and hips_visible == 2 and ankles_visible == 2:
                        qualified_fullbody_frames += 1
                else:
                    print(f"Frame {frame_idx}: No pose detected", file=sys.stderr)
                
                foot_positions.append(frame_feet)
                
            except Exception as e:
                print(f"Frame {frame_idx} processing error: {e}", file=sys.stderr)
                foot_positions.append([])
        
        # Require a MINIMUM number of ankle detections spread across frames to be confident that feet are actually visible.
        min_foot_detections = 10  # need many ankle detections (across frames) to proceed
        
        total_foot_detections = sum(len(frame_feet) for frame_feet in foot_positions)
        
        if total_foot_detections < min_foot_detections:
            print(
                f"Too few ankle detections ({total_foot_detections} < {min_foot_detections}) – skipping foot-tapping analysis to avoid false positives",
                file=sys.stderr,
            )
            return {
                'detected': False,
                'confidence': 0.0,
                'pattern': 'too_few_ankle_detections',
                'tap_count': 0,
                'analysis_type': 'insufficient_ankles'
            }
        
        # Require that shoulders are visible and that the vertical span shoulder→ankle covers at least half the frame height.
        if not shoulder_y_list:
            print("No reliable shoulder landmarks – body not fully in view; skipping foot analysis", file=sys.stderr)
            return {
                'detected': False,
                'confidence': 0.0,
                'pattern': 'no_shoulders',
                'tap_count': 0,
                'analysis_type': 'no_full_body'
            }
        
        # Ensure we have enough frames where the entire body (shoulders, hips, ankles) is confidently visible.
        if qualified_fullbody_frames < 3:
            print(
                f"Only {qualified_fullbody_frames} full-body frames detected – skipping foot tapping analysis",
                file=sys.stderr,
            )
            return {
                'detected': False,
                'confidence': 0.0,
                'pattern': 'not_full_body',
                'tap_count': 0,
                'analysis_type': 'insufficient_fullbody'
            }
        
        avg_ankle_y = sum(rel_y_list) / len(rel_y_list) if rel_y_list else 0.0
        
        avg_shoulder_y = sum(shoulder_y_list) / len(shoulder_y_list)
        avg_hip_y = sum(hip_y_list) / len(hip_y_list) if hip_y_list else 0.0
        
        # Full-body span using shoulders to ankles
        body_span = avg_ankle_y - avg_shoulder_y  # normalized 0-1
        
        if body_span < 0.7:  # Require at least ~70 % of frame height to ensure full body
            print(
                f"Body span too small for reliable foot tap detection (span={body_span:.2f}); skipping.",
                file=sys.stderr,
            )
            return {
                'detected': False,
                'confidence': 0.0,
                'pattern': 'body_not_full',
                'tap_count': 0,
                'analysis_type': 'incomplete_body'
            }
        
        print(f"Using high-quality pose detection with {sum(len(frame_feet) for frame_feet in foot_positions)} total foot detections", file=sys.stderr)
        
    except Exception as e:
        print(f"MediaPipe pose detection failed: {e}", file=sys.stderr)
        return {
            'detected': False,
            'confidence': 0.0,
            'pattern': "pose_detection_failed",
            'tap_count': 0,
            'analysis_type': 'pose_detection_error'
        }
    
    # STRICT MOVEMENT ANALYSIS for foot tapping
    movement_taps = 0
    movement_score = 0.0
    
    if len(frames) >= 2:
        try:
            import base64
            import cv2
            import numpy as np
            
            print(f"Starting STRICT foot movement analysis...", file=sys.stderr)
            
            total_frame_diff = 0
            valid_comparisons = 0
            
            for frame_idx in range(1, len(frames)):
                try:
                    # Decode current and previous frames
                    curr_frame_bytes = base64.b64decode(frames[frame_idx].split(',')[1])
                    prev_frame_bytes = base64.b64decode(frames[frame_idx-1].split(',')[1])
                    
                    curr_array = np.frombuffer(curr_frame_bytes, dtype=np.uint8)
                    prev_array = np.frombuffer(prev_frame_bytes, dtype=np.uint8)
                    
                    curr_frame = cv2.imdecode(curr_array, cv2.IMREAD_COLOR)
                    prev_frame = cv2.imdecode(prev_array, cv2.IMREAD_COLOR)
                    
                    if curr_frame is not None and prev_frame is not None:
                        # Focus on lower part of image where feet would be
                        h, w = curr_frame.shape[:2]
                        foot_area_y_start = int(h * 0.75)  # Lower 25% of image
                        
                        curr_gray = cv2.cvtColor(curr_frame[foot_area_y_start:, :], cv2.COLOR_BGR2GRAY)
                        prev_gray = cv2.cvtColor(prev_frame[foot_area_y_start:, :], cv2.COLOR_BGR2GRAY)
                        
                        # Resize to same size if needed
                        if curr_gray.shape != prev_gray.shape:
                            min_h, min_w = min(curr_gray.shape[0], prev_gray.shape[0]), min(curr_gray.shape[1], prev_gray.shape[1])
                            curr_gray = cv2.resize(curr_gray, (min_w, min_h))
                            prev_gray = cv2.resize(prev_gray, (min_w, min_h))
                        
                        # Calculate frame difference in foot area
                        diff = cv2.absdiff(curr_gray, prev_gray)
                        
                        # VERY STRICT: Require substantial changes in foot area
                        diff_np = np.asarray(diff)
                        changed_pixels = int(np.sum(diff_np > 30))  # type: ignore[operator]
                        total_pixels = diff_np.size
                        change_ratio = changed_pixels / total_pixels
                        
                        # Average intensity of changes
                        avg_intensity = float(np.mean(diff_np))  # type: ignore[arg-type]
                        
                        # Combined movement score
                        frame_movement = change_ratio * 0.7 + (avg_intensity / 255) * 0.3
                        total_frame_diff += frame_movement
                        valid_comparisons += 1
                        
                        print(f"Frame {frame_idx}: foot_area change_ratio={change_ratio:.4f}, avg_intensity={avg_intensity:.1f}, movement={frame_movement:.4f}", file=sys.stderr)
                        
                        # VERY STRICT: Only detect substantial foot movements
                        if change_ratio > 0.12 and avg_intensity > 50:  # Much higher thresholds than hands
                            movement_taps += 1
                            print(f"Frame {frame_idx}: SIGNIFICANT FOOT TAPPING MOTION DETECTED! (change_ratio={change_ratio:.4f}, avg_intensity={avg_intensity:.1f})", file=sys.stderr)
                
                except Exception as e:
                    print(f"Frame {frame_idx} comparison error: {e}", file=sys.stderr)
                    continue
            
            # Calculate overall movement with VERY STRICT requirements
            if valid_comparisons > 0:
                avg_movement = total_frame_diff / valid_comparisons
                
                # VERY STRICT SCORING: Require multiple significant movements for foot tapping detection
                if movement_taps >= 4 and avg_movement > 0.035:  # Need at least 4 taps AND substantial movement
                    movement_score = min(0.6, max(0.3, avg_movement * 15 + movement_taps * 0.08))
                    print(f"REPETITIVE FOOT TAPPING DETECTED! avg_movement={avg_movement:.6f}, movement_taps={movement_taps}, score={movement_score:.3f}", file=sys.stderr)
                else:
                    print(f"No repetitive foot tapping pattern: avg_movement={avg_movement:.6f}, movement_taps={movement_taps} (need 4+ taps, avg>0.035)", file=sys.stderr)
            else:
                print(f"No valid frame comparisons possible", file=sys.stderr)
                
        except Exception as e:
            print(f"Strict foot movement detection failed: {e}", file=sys.stderr)
    
    # MediaPipe ankle position analysis
    tap_count = 0
    ankle_score = 0.0
    
    if any(len(frame_feet) > 0 for frame_feet in foot_positions):
        print(f"Running MediaPipe ankle analysis on {sum(len(frame_feet) for frame_feet in foot_positions)} foot detections...", file=sys.stderr)
        
        if len(foot_positions) >= 2:
            for foot_idx in range(2):  # Check left and right feet
                position_history = []
                
                for frame_feet in foot_positions:
                    if len(frame_feet) > foot_idx:
                        position_history.append(frame_feet[foot_idx])
                
                if len(position_history) >= 3:  # Need at least 3 positions
                    y_positions = [pos[1] for pos in position_history]
                    x_positions = [pos[0] for pos in position_history]
                    
                    total_movement = 0
                    individual_taps = 0
                    
                    for i in range(1, len(y_positions)):
                        y_movement = abs(y_positions[i] - y_positions[i-1])
                        x_movement = abs(x_positions[i] - x_positions[i-1])
                        frame_movement = (y_movement**2 + x_movement**2)**0.5
                        total_movement += frame_movement
                        
                        if frame_movement > 20:  # Higher threshold than hands (was 15)
                            individual_taps += 1
                            print(f"Foot tap motion detected at frame {i}: movement={frame_movement:.1f}px", file=sys.stderr)
                    
                    avg_movement = total_movement / max(1, len(y_positions) - 1)
                    
                    # VERY STRICT: Need multiple taps AND significant average movement
                    if avg_movement > 15 and individual_taps >= 4:  # Higher thresholds than hands
                        ankle_score = max(ankle_score, min(0.6, avg_movement * 0.03 + individual_taps * 0.12))
                        tap_count = max(tap_count, individual_taps)
                        print(f"Foot {foot_idx}: MediaPipe repetitive tapping detected - movements={individual_taps}, avg_movement={avg_movement:.1f}, score={ankle_score:.3f}", file=sys.stderr)
                    else:
                        print(f"Foot {foot_idx}: Not enough tapping activity - movements={individual_taps}, avg_movement={avg_movement:.1f} (need 4+ taps, avg>15)", file=sys.stderr)
    
    # Combine detection methods with ULTRA-STRICT validation
    final_score = max(movement_score, ankle_score)
    final_tap_count = max(tap_count, movement_taps)
    
    # ULTRA-STRICT: Require VERY clear evidence of intentional foot tapping
    ultra_strict_detected = False
    ultra_strict_confidence = 0.0
    
    if final_score > 0:
        # Must have BOTH high confidence AND multiple detection methods agreeing
        methods_detected = 0
        if movement_taps >= 4:  # Need lots of movement-based taps
            methods_detected += 1
        if tap_count >= 4:  # Need lots of MediaPipe-based taps
            methods_detected += 1
        if final_score > 0.5:  # Need very high confidence
            methods_detected += 1
            
        # Only detect if multiple methods agree AND very high confidence
        if methods_detected >= 2 and final_score > 0.4:
            ultra_strict_detected = True
            ultra_strict_confidence = final_score
        else:
            print(f"ULTRA-STRICT FOOT REJECTION: methods_detected={methods_detected}, confidence={final_score:.3f} (need 2+ methods AND 0.4+ confidence)", file=sys.stderr)
    
    print(f"FINAL FOOT TAPPING ANALYSIS (ULTRA-STRICT): detected={ultra_strict_detected}, confidence={ultra_strict_confidence:.3f}, taps={final_tap_count}", file=sys.stderr)
    
    return {
        'detected': ultra_strict_detected,
        'confidence': ultra_strict_confidence,
        'tap_count': final_tap_count if ultra_strict_detected else 0,
        'movement_score': movement_score,
        'ankle_score': ankle_score,
        'analysis_type': 'ultra_strict_foot_pattern_detection'
    }


def _analyze_sit_stand_transitions(frames):
    """
    ENHANCED sit-stand ACTION detection - counts only the moments of transition:
    
    WHAT WE COUNT:
    ✅ "Sitting down" action (standing → sitting transition)
    ✅ "Standing up" action (sitting → standing transition)
    
    WHAT WE DON'T COUNT:
    ❌ Being seated (static sitting state)
    ❌ Being standing (static standing state)
    ❌ Small movements while maintaining same posture
    
    LOGIC:
    - Same posture as before → detected=False (no action occurred)
    - Different posture → detected=True (action occurred: sitting down OR standing up)
    """
    print(f"Analyzing {len(frames)} frames for sit-stand ACTIONS (transitions only)...", file=sys.stderr)
    
    # Load previous posture state with baseline tracking and cooldown
    previous_state = _load_sit_stand_state()
    previous_posture = previous_state['posture']
    baseline_count = previous_state['baseline_count']
    last_transition_time = previous_state['last_transition_time']
    
    import time
    current_time = time.time()
    time_since_last_transition = current_time - last_transition_time
    min_cooldown_seconds = 15  # INCREASED to 15 seconds between transitions (was 8)
    
    print(f"Previous posture: {previous_posture}, baseline_count: {baseline_count}, time_since_last: {time_since_last_transition:.1f}s", file=sys.stderr)
    
    # Analyze recent frames to determine current posture
    analysis_window = min(12, len(frames))  # Reduced from 20 for faster response
    recent_frames = frames[-analysis_window:] if len(frames) > 0 else frames
    
    try:
        import mediapipe as mp
        mp_pose = mp.solutions.pose
        
        # Enhanced pose detection with LOWER confidence for easier detection
        pose = mp_pose.Pose(
            static_image_mode=True,
            model_complexity=1,  # Lower complexity for faster, more permissive detection
            min_detection_confidence=0.5,  # Lowered from 0.7 to 0.5
            min_tracking_confidence=0.4,   # Lowered from 0.6 to 0.4
            enable_segmentation=False
        )
        
        posture_states = []
        
        for frame_idx, frame_data in enumerate(recent_frames):
            try:
                import base64
                import cv2
                import numpy as np
                
                frame_bytes = base64.b64decode(frame_data.split(',')[1])
                frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
                frame = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                
                # Enhance frame quality for better pose detection
                frame_rgb = cv2.convertScaleAbs(frame_rgb, alpha=1.1, beta=10)  # Slight contrast/brightness boost
                
                results = pose.process(frame_rgb)
                
                if results.pose_landmarks:
                    landmarks = results.pose_landmarks.landmark
                    
                    # Enhanced landmark extraction with better indexing
                    # Upper body
                    left_shoulder = landmarks[11]   # Left shoulder
                    right_shoulder = landmarks[12]  # Right shoulder
                    nose = landmarks[0]             # Nose for head reference
                    
                    # Core body
                    left_hip = landmarks[23]        # Left hip
                    right_hip = landmarks[24]       # Right hip
                    
                    # Lower body
                    left_knee = landmarks[25]       # Left knee
                    right_knee = landmarks[26]      # Right knee
                    left_ankle = landmarks[27]      # Left ankle
                    right_ankle = landmarks[28]     # Right ankle
                    
                    # Calculate average positions for stability
                    shoulder_y = (left_shoulder.y + right_shoulder.y) / 2
                    shoulder_x = (left_shoulder.x + right_shoulder.x) / 2
                    hip_y = (left_hip.y + right_hip.y) / 2
                    hip_x = (left_hip.x + right_hip.x) / 2
                    knee_y = (left_knee.y + right_knee.y) / 2
                    knee_x = (left_knee.x + right_knee.x) / 2
                    ankle_y = (left_ankle.y + right_ankle.y) / 2
                    ankle_x = (left_ankle.x + right_ankle.x) / 2
                    
                    # Enhanced visibility check - require good visibility of key landmarks
                    key_landmarks = [left_shoulder, right_shoulder, left_hip, right_hip, 
                                   left_knee, right_knee, left_ankle, right_ankle]
                    visibility_scores = [lm.visibility for lm in key_landmarks]
                    avg_visibility = sum(visibility_scores) / len(visibility_scores)
                    min_visibility = min(visibility_scores)
                    
                    print(f"Frame {frame_idx}: avg_visibility={avg_visibility:.3f}, min_visibility={min_visibility:.3f}", file=sys.stderr)
                    
                    if avg_visibility > 0.6 and min_visibility > 0.3:  # MUCH more permissive visibility (was 0.75 and 0.5)
                        # ENHANCED GEOMETRIC ANALYSIS - Multiple indicators
                        
                        # 1. Body compression ratio (key indicator)
                        total_body_height = ankle_y - shoulder_y
                        torso_length = hip_y - shoulder_y
                        leg_length = ankle_y - hip_y
                        thigh_length = knee_y - hip_y
                        shin_length = ankle_y - knee_y
                        
                        # 2. Advanced posture ratios
                        body_compression = total_body_height / max(0.1, abs(ankle_y - nose.y))
                        torso_to_total = torso_length / max(0.1, total_body_height)
                        thigh_angle_indicator = thigh_length / max(0.1, torso_length)
                        knee_bend_severity = abs(knee_y - hip_y) / max(0.1, abs(ankle_y - hip_y))
                        
                        # 3. Spatial relationships (sitting vs standing patterns)
                        hip_knee_gap = knee_y - hip_y  # Positive when knees below hips
                        knee_ankle_gap = ankle_y - knee_y  # Leg extension
                        
                        # 4. Body alignment analysis
                        body_vertical_alignment = abs(shoulder_x - hip_x) + abs(hip_x - knee_x)
                        posture_straightness = 1.0 - min(1.0, body_vertical_alignment * 5)  # Normalize
                        
                        # ENHANCED SCORING SYSTEM with multiple validation methods
                        sitting_indicators = 0
                        standing_indicators = 0
                        confidence_factors = []
                        
                        # Indicator 1: Body compression (most reliable)
                        if body_compression < 0.75:  # Very compressed = sitting
                            sitting_indicators += 3
                            confidence_factors.append(("compression_sitting", 0.9))
                            print(f"  → SITTING: Body compression {body_compression:.3f} < 0.75", file=sys.stderr)
                        elif body_compression > 0.90:  # Extended = standing
                            standing_indicators += 3
                            confidence_factors.append(("compression_standing", 0.9))
                            print(f"  → STANDING: Body compression {body_compression:.3f} > 0.90", file=sys.stderr)
                        
                        # Indicator 2: Hip-knee relationship (critical for sitting)
                        if hip_knee_gap > 0.08:  # Knees significantly below hips = sitting
                            sitting_indicators += 2
                            confidence_factors.append(("hip_knee_sitting", 0.8))
                            print(f"  → SITTING: Hip-knee gap {hip_knee_gap:.3f} > 0.08", file=sys.stderr)
                        elif hip_knee_gap < -0.02:  # Hips below knees = standing
                            standing_indicators += 2
                            confidence_factors.append(("hip_knee_standing", 0.8))
                            print(f"  → STANDING: Hip-knee gap {hip_knee_gap:.3f} < -0.02", file=sys.stderr)
                        
                        # Indicator 3: Thigh angle severity
                        if thigh_angle_indicator > 0.5:  # Bent thighs = sitting
                            sitting_indicators += 2
                            confidence_factors.append(("thigh_sitting", 0.7))
                            print(f"  → SITTING: Thigh angle {thigh_angle_indicator:.3f} > 0.5", file=sys.stderr)
                        elif thigh_angle_indicator < 0.3:  # Straight thighs = standing
                            standing_indicators += 2
                            confidence_factors.append(("thigh_standing", 0.7))
                            print(f"  → STANDING: Thigh angle {thigh_angle_indicator:.3f} < 0.3", file=sys.stderr)
                        
                        # Indicator 4: Knee bend severity
                        if knee_bend_severity > 0.6:  # Severe knee bend = sitting
                            sitting_indicators += 1
                            confidence_factors.append(("knee_bend_sitting", 0.6))
                            print(f"  → SITTING: Knee bend {knee_bend_severity:.3f} > 0.6", file=sys.stderr)
                        elif knee_bend_severity < 0.4:  # Minimal knee bend = standing
                            standing_indicators += 1
                            confidence_factors.append(("knee_bend_standing", 0.6))
                            print(f"  → STANDING: Knee bend {knee_bend_severity:.3f} < 0.4", file=sys.stderr)
                        
                        # Indicator 5: Torso proportion check
                        if torso_to_total > 0.55:  # Large torso proportion = sitting (legs folded)
                            sitting_indicators += 1
                            confidence_factors.append(("torso_prop_sitting", 0.5))
                            print(f"  → SITTING: Torso proportion {torso_to_total:.3f} > 0.55", file=sys.stderr)
                        elif torso_to_total < 0.40:  # Small torso proportion = standing (full height)
                            standing_indicators += 1
                            confidence_factors.append(("torso_prop_standing", 0.5))
                            print(f"  → STANDING: Torso proportion {torso_to_total:.3f} < 0.40", file=sys.stderr)
                        
                        # FINAL POSTURE DETERMINATION with confidence calculation
                        total_indicators = sitting_indicators + standing_indicators
                        if total_indicators == 0:
                            state = "uncertain"
                            confidence = 0.0
                            print(f"  → UNCERTAIN: No clear indicators", file=sys.stderr)
                        elif sitting_indicators > standing_indicators:
                            state = "sitting"
                            # Calculate confidence based on indicator strength and agreement
                            indicator_strength = sitting_indicators / max(1, total_indicators)
                            avg_confidence = sum(cf[1] for cf in confidence_factors if "sitting" in cf[0]) / max(1, sum(1 for cf in confidence_factors if "sitting" in cf[0]))
                            confidence = min(0.95, indicator_strength * avg_confidence * min(1.2, sitting_indicators / 3))
                            print(f"  → SITTING: {sitting_indicators}/{total_indicators} indicators, confidence={confidence:.3f}", file=sys.stderr)
                        elif standing_indicators > sitting_indicators:
                            state = "standing"
                            # Calculate confidence based on indicator strength and agreement
                            indicator_strength = standing_indicators / max(1, total_indicators)
                            avg_confidence = sum(cf[1] for cf in confidence_factors if "standing" in cf[0]) / max(1, sum(1 for cf in confidence_factors if "standing" in cf[0]))
                            confidence = min(0.95, indicator_strength * avg_confidence * min(1.2, standing_indicators / 3))
                            print(f"  → STANDING: {standing_indicators}/{total_indicators} indicators, confidence={confidence:.3f}", file=sys.stderr)
                        else:
                            state = "uncertain"
                            confidence = 0.3
                            print(f"  → UNCERTAIN: Tied indicators ({sitting_indicators}={standing_indicators})", file=sys.stderr)
                        
                        posture_states.append({
                            'state': state,
                            'confidence': confidence,
                            'sitting_indicators': sitting_indicators,
                            'standing_indicators': standing_indicators,
                            'visibility': avg_visibility
                        })
                        
                    else:
                        print(f"Frame {frame_idx}: Insufficient visibility (avg={avg_visibility:.3f}, min={min_visibility:.3f})", file=sys.stderr)
                        posture_states.append({'state': 'unknown', 'confidence': 0.0})
                else:
                    print(f"Frame {frame_idx}: No pose landmarks detected", file=sys.stderr)
                    posture_states.append({'state': 'unknown', 'confidence': 0.0})
                
            except Exception as e:
                print(f"Frame {frame_idx} processing error: {e}", file=sys.stderr)
                posture_states.append({'state': 'unknown', 'confidence': 0.0})
        
        # LOWERED REQUIREMENTS for easier detection
        valid_states = [s for s in posture_states if s['state'] in ['sitting', 'standing'] and s['confidence'] > 0.4]  # Much lower confidence (was 0.6)
        
        if len(valid_states) < 6:  # Much fewer frames required (was 12)
            print(f"Not enough valid posture states ({len(valid_states)}) - requiring 6+ frames (lowered threshold)", file=sys.stderr)
            return {
                'detected': False,
                'confidence': 0.0,
                'analysis_type': 'insufficient_frames_low_threshold',
                'valid_frames': len(valid_states),
                'total_frames': len(posture_states)
            }
        
        # Calculate weighted consensus with MUCH lower requirements
        sitting_weight = sum(s['confidence'] for s in valid_states if s['state'] == 'sitting')
        standing_weight = sum(s['confidence'] for s in valid_states if s['state'] == 'standing')
        total_weight = sitting_weight + standing_weight
        
        sitting_count = sum(1 for s in valid_states if s['state'] == 'sitting')
        standing_count = sum(1 for s in valid_states if s['state'] == 'standing')
        
        # MUCH more permissive consensus (was 85%)
        consensus_threshold = 0.65  # Lowered from 0.85 to 0.65
        current_posture = None
        posture_confidence = 0.0
        
        if sitting_weight / total_weight >= consensus_threshold and sitting_count >= (len(valid_states) * 0.6):  # Lowered from 0.8 to 0.6
            current_posture = 'sitting'
            posture_confidence = sitting_weight / total_weight
            print(f"SITTING consensus (LOW THRESHOLD): {sitting_count}/{len(valid_states)} frames, weight={sitting_weight:.2f}/{total_weight:.2f} ({posture_confidence:.3f})", file=sys.stderr)
        elif standing_weight / total_weight >= consensus_threshold and standing_count >= (len(valid_states) * 0.6):  # Lowered from 0.8 to 0.6
            current_posture = 'standing'
            posture_confidence = standing_weight / total_weight
            print(f"STANDING consensus (LOW THRESHOLD): {standing_count}/{len(valid_states)} frames, weight={standing_weight:.2f}/{total_weight:.2f} ({posture_confidence:.3f})", file=sys.stderr)
        else:
            print(f"No consensus reached (LOW THRESHOLD): sitting={sitting_count}({sitting_weight:.2f}), standing={standing_count}({standing_weight:.2f}), total={len(valid_states)}", file=sys.stderr)
            return {
                'detected': False,
                'confidence': 0.0,
                'analysis_type': 'no_posture_consensus_low_threshold',
                'sitting_frames': sitting_count,
                'standing_frames': standing_count,
                'total_valid_frames': len(valid_states)
            }
        
        print(f"ENHANCED posture determined: '{current_posture}' (confidence: {posture_confidence:.3f})", file=sys.stderr)
        
        # Check for ACTION detection with cooldown protection and higher baseline stability
        if previous_posture is None:
            # First time - establish baseline posture, no action to count yet
            print(f"🏁 BASELINE ESTABLISHMENT: Initial posture detected as '{current_posture}' (baseline=1) - NO ACTION counted", file=sys.stderr)
            _save_sit_stand_state(current_posture, 1, current_time)
            return {
                'detected': False,  # No action occurred
                'confidence': posture_confidence,
                'analysis_type': 'baseline_establishment',
                'current_posture': current_posture,
                'baseline_count': 1,
                'message': f'Establishing baseline posture: {current_posture}'
            }
        elif previous_posture == current_posture:
            # Same posture maintained - increment baseline, NO ACTION to count
            new_baseline_count = baseline_count + 1
            print(f"📍 MAINTAINING POSTURE: Still {current_posture} (baseline={new_baseline_count}) - NO ACTION counted", file=sys.stderr)
            _save_sit_stand_state(current_posture, new_baseline_count, last_transition_time)  # Keep same transition time
            return {
                'detected': False,  # No action occurred
                'confidence': posture_confidence,
                'analysis_type': 'maintaining_same_posture',
                'current_posture': current_posture,
                'baseline_count': new_baseline_count,
                'message': f'Maintaining {current_posture} position (stable x{new_baseline_count})'
            }
        else:
            # Different posture detected - check cooldown and baseline requirements
            if time_since_last_transition < min_cooldown_seconds:
                # Still in cooldown period - ignore this detection to prevent false positives
                print(f"🛑 COOLDOWN ACTIVE: Ignoring posture change {previous_posture} → {current_posture} (only {time_since_last_transition:.1f}s since last transition, need {min_cooldown_seconds}s)", file=sys.stderr)
                _save_sit_stand_state(previous_posture, baseline_count, last_transition_time)  # Keep previous state
                return {
                    'detected': False,  # No action counted due to cooldown
                    'confidence': posture_confidence,
                    'analysis_type': 'cooldown_active',
                    'previous_posture': previous_posture,
                    'current_posture': current_posture,
                    'time_remaining': min_cooldown_seconds - time_since_last_transition,
                    'message': f'Transition blocked by cooldown ({time_since_last_transition:.1f}s / {min_cooldown_seconds}s)'
                }
            elif baseline_count < 5:  # INCREASED baseline requirement to 5 for maximum stability (was 3)
                # Not enough baseline stability - don't count action yet
                print(f"⚠️ POSTURE CHANGE DETECTED but baseline insufficient: {previous_posture} → {current_posture} (baseline was only {baseline_count}) - NO ACTION counted yet", file=sys.stderr)
                _save_sit_stand_state(current_posture, 1, last_transition_time)  # Reset baseline for new posture, keep transition time
                return {
                    'detected': False,  # No action counted due to insufficient baseline
                    'confidence': posture_confidence,
                    'analysis_type': 'posture_change_insufficient_baseline',
                    'previous_posture': previous_posture,
                    'current_posture': current_posture,
                    'baseline_count': 1,
                    'required_baseline': 5,  # Much higher requirement for stability
                    'message': f'Detected posture change but need more stability (baseline was {baseline_count}/5)'
                }
            else:
                # Sufficient baseline AND cooldown passed - but check confidence difference
                # Define the action first
                if previous_posture == 'sitting' and current_posture == 'standing':
                    action = 'STANDING UP'
                    action_description = 'stood up from sitting position'
                elif previous_posture == 'standing' and current_posture == 'sitting':
                    action = 'SITTING DOWN'
                    action_description = 'sat down from standing position'
                else:
                    action = f'{previous_posture.upper()}_TO_{current_posture.upper()}'
                    action_description = f'changed from {previous_posture} to {current_posture}'
                
                # Require high confidence in new posture AND significant difference from typical confidence
                if posture_confidence < 0.75:  # Require very high confidence for transitions
                    print(f"🚫 CONFIDENCE TOO LOW: {action} blocked (confidence {posture_confidence:.3f} < 0.75 required)", file=sys.stderr)
                    _save_sit_stand_state(previous_posture, baseline_count, last_transition_time)  # Keep previous state
                    return {
                        'detected': False,
                        'confidence': posture_confidence,
                        'analysis_type': 'confidence_too_low_for_transition',
                        'previous_posture': previous_posture,
                        'current_posture': current_posture,
                        'required_confidence': 0.75,
                        'message': f'Confidence too low for transition ({posture_confidence:.3f} < 0.75)'
                    }
                
                # All checks passed - COUNT THE ACTION!
                print(f"🎯 ACTION DETECTED: {action}! Person {action_description} (confidence: {posture_confidence:.3f}, baseline was stable: {baseline_count}, cooldown passed: {time_since_last_transition:.1f}s)", file=sys.stderr)
                
                # Save new state with baseline count 1 and new transition time
                _save_sit_stand_state(current_posture, 1, current_time)
                
                return {
                    'detected': True,  # ACTION COUNTED!
                    'confidence': posture_confidence,
                    'analysis_type': 'action_detected',
                    'action': action,
                    'action_description': action_description,
                    'previous_posture': previous_posture,
                    'current_posture': current_posture,
                    'transition_count': 1,  # Always 1 per action
                    'previous_baseline_count': baseline_count,
                    'cooldown_passed': time_since_last_transition,
                    'valid_frames_analyzed': len(valid_states),
                    'message': f'Action counted: {action_description}'
                }
        
    except Exception as e:
        print(f"Enhanced sit-stand analysis error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return {
            'detected': False,
            'confidence': 0.0,
            'analysis_type': 'enhanced_analysis_error',
            'error': str(e)
        }


def _load_sit_stand_state():
    """Load the last known sit-stand state from file"""
    try:
        if SIT_STAND_STATE_FILE.exists():
            with open(SIT_STAND_STATE_FILE, 'r') as f:
                state = json.load(f)
                posture = state.get('last_posture', None)
                baseline_count = state.get('baseline_count', 0)
                last_transition_time = state.get('last_transition_time', 0)
                print(f"Loaded previous sit-stand state: {posture} (baseline_count: {baseline_count}, last_transition: {last_transition_time})", file=sys.stderr)
                return {'posture': posture, 'baseline_count': baseline_count, 'last_transition_time': last_transition_time}
        else:
            print(f"No sit-stand state file found, creating initial state", file=sys.stderr)
    except Exception as e:
        print(f"Error loading sit-stand state: {e}", file=sys.stderr)
    return {'posture': None, 'baseline_count': 0, 'last_transition_time': 0}

def _save_sit_stand_state(posture, baseline_count=0, last_transition_time=None):
    """Save the current sit-stand state to file"""
    try:
        import datetime
        import time
        if last_transition_time is None:
            last_transition_time = time.time()
        state = {
            'last_posture': posture, 
            'baseline_count': baseline_count,
            'last_transition_time': last_transition_time,
            'timestamp': datetime.datetime.now().isoformat()
        }
        with open(SIT_STAND_STATE_FILE, 'w') as f:
            json.dump(state, f)
        print(f"Saved sit-stand state: {posture} (baseline_count: {baseline_count})", file=sys.stderr)
    except Exception as e:
        print(f"Error saving sit-stand state: {e}", file=sys.stderr)


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

    print(f"[{behavior}] Starting detection analysis...", file=sys.stderr)

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
                frame_analysis = _analyze_frame_movement(frames if isinstance(frames, list) else [])
                confidence = max(0.05, min(0.4, frame_analysis * 1.2 + 0.05))  # More conservative
                detected = bool(confidence > 0.5)  # Much higher threshold - only detect significant movement
                result = {"detected": detected, "confidence": round(float(confidence), 3), "gaze": "straight", "fallback": True}
                print(f"[eye_gaze] FALLBACK RESULT: detected={detected}, confidence={confidence:.3f} (from movement analysis)", file=sys.stderr)
                return result

            frames_tensor = torch.stack(crops, dim=0).unsqueeze(0).to(DEVICE)  # (1, T, C, H, W)
            logits = model(frames_tensor)  # shape (1, 5)

            probs = torch.softmax(logits, dim=1)[0]  # type: ignore[index]
            prob, idx = probs.max(dim=0)
            gaze_classes = ["down", "left", "right", "straight", "up"]
            idx_int: int = int(idx.item())
            label = gaze_classes[idx_int] if idx_int < len(gaze_classes) else str(idx_int)

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

            # SPECIAL HANDLING FOR HAND TAPPING - Use pattern analysis ONLY
            if behavior == "tapping_hands":
                print(f"[tapping_hands] Using ADVANCED PATTERN ANALYSIS for actual tapping/clapping detection", file=sys.stderr)
                
                # Use the new pattern analysis to detect actual tapping/clapping
                pattern_result = _analyze_hand_tapping_patterns([], frames)
                
                if pattern_result["detected"]:
                    print(f"[tapping_hands] PATTERN DETECTED: {pattern_result['pattern']} with confidence {pattern_result['confidence']:.3f}", file=sys.stderr)
                    return {
                        "detected": True,
                        "confidence": round(pattern_result["confidence"], 4),
                        "pattern": pattern_result["pattern"],
                        "tapping_score": round(pattern_result["tapping_score"], 3),
                        "clapping_score": round(pattern_result["clapping_score"], 3),
                        "tap_count": pattern_result["tap_count"],
                        "clap_count": pattern_result["clap_count"],
                        "analysis_type": "pattern_recognition"
                    }
                else:
                    print(f"[tapping_hands] NO TAPPING PATTERN DETECTED: {pattern_result['pattern']} (confidence: {pattern_result['confidence']:.3f})", file=sys.stderr)
                    # DO NOT fall back to PyTorch model - pattern analysis is authoritative
                    return {
                        "detected": False,
                        "confidence": round(pattern_result["confidence"], 4),
                        "pattern": pattern_result["pattern"],
                        "tap_count": pattern_result.get("tap_count", 0),
                        "clap_count": pattern_result.get("clap_count", 0),
                        "analysis_type": "pattern_recognition"
                    }

            # FEET TAPPING - Use STRICT pattern analysis ONLY (same as hands)
            if behavior == "tapping_feet":
                print(f"[tapping_feet] Using ULTRA-STRICT PATTERN ANALYSIS for actual foot tapping detection", file=sys.stderr)
                
                # Use the new strict pattern analysis to detect actual foot tapping
                pattern_result = _analyze_foot_tapping_patterns(frames)
                
                if pattern_result["detected"]:
                    print(f"[tapping_feet] FOOT TAPPING DETECTED with confidence {pattern_result['confidence']:.3f}", file=sys.stderr)
                    return {
                        "detected": True,
                        "confidence": round(pattern_result["confidence"], 4),
                        "tap_count": pattern_result["tap_count"],
                        "movement_score": round(pattern_result["movement_score"], 3),
                        "ankle_score": round(pattern_result["ankle_score"], 3),
                        "analysis_type": pattern_result["analysis_type"]
                    }
                else:
                    print(f"[tapping_feet] NO FOOT TAPPING PATTERN DETECTED (confidence: {pattern_result['confidence']:.3f})", file=sys.stderr)
                    # DO NOT fall back to PyTorch model - pattern analysis is authoritative
                    return {
                        "detected": False,
                        "confidence": round(pattern_result["confidence"], 4),
                        "tap_count": pattern_result.get("tap_count", 0),
                        "analysis_type": pattern_result["analysis_type"]
                    }

        elif behavior == "sit_stand":
            print(f"[sit_stand] Using TRANSITION DETECTION for sit-stand analysis (whole body)", file=sys.stderr)
            
            # Extract frames from data
            if isinstance(data, dict):
                frames = data.get("frame_sequence") or data.get(behavior) or []
            else:
                frames = data
            
            # Use the transition analysis to detect actual sit-stand movements
            transition_result = _analyze_sit_stand_transitions(frames)
            
            if transition_result["detected"]:
                print(f"[sit_stand] TRANSITION DETECTED: {transition_result.get('transition_type', 'unknown')} with confidence {transition_result['confidence']:.3f}", file=sys.stderr)
                return {
                    "detected": True,
                    "confidence": round(transition_result["confidence"], 4),
                    "transition_type": transition_result.get("transition_type", "unknown"),
                    "previous_posture": transition_result.get("previous_posture", "unknown"),
                    "current_posture": transition_result.get("current_posture", "unknown"),
                    "transition_count": transition_result.get("transition_count", 1),
                    "analysis_type": transition_result["analysis_type"]
                }
            else:
                print(f"[sit_stand] NO TRANSITION DETECTED: {transition_result['analysis_type']} (confidence: {transition_result['confidence']:.3f})", file=sys.stderr)
                return {
                    "detected": False,
                    "confidence": round(transition_result["confidence"], 4),
                    "current_posture": transition_result.get("current_posture", "unknown"),
                    "analysis_type": transition_result["analysis_type"]
                }

        elif behavior == "rapid_talking":
            # -----------------------------------------------------------
            # Rapid talking – confidence based on average WPM thresholds
            #   • avg WPM < 150  → confidence = 0.1 (not detected)
            #   • 150 ≤ avg WPM < 200 → confidence = 0.5 (moderately detected)
            #   • avg WPM ≥ 200 → confidence = 1.0 (strongly detected)
            # -----------------------------------------------------------

            seq = data if isinstance(data, list) else data.get(behavior) or []

            # Filter out any non-numeric values so they don't break the math
            numeric_vals = [float(x) for x in seq if isinstance(x, (int, float))]

            if not numeric_vals:
                print("[rapid_talking] No numeric WPM values provided – confidence=0.0 (detected=False)", file=sys.stderr)
                result = {"detected": False, "confidence": 0.0}
                return result

            avg_wpm = sum(numeric_vals) / len(numeric_vals)
            print(f"[rapid_talking] Avg WPM across {len(numeric_vals)} samples = {avg_wpm:.2f}", file=sys.stderr)

            if avg_wpm < 150:
                prob = 0.1
                detected = False
            elif avg_wpm < 200:
                prob = 0.5
                detected = True  # Only detect in 150–200 WPM range
            else:
                prob = 1.0
                detected = False  # ≥200 WPM -> very rapid, but NOT flagged per new requirement

            print(
                f"[rapid_talking] Confidence={prob:.2f}, detected={detected} (150–200 only rule)",
                file=sys.stderr,
            )

            return {"detected": detected, "confidence": round(prob, 4)}

        else:
            prob = 0.0

        prob = float(max(0.0, min(1.0, prob)))  # clamp to [0,1]
        detected = bool(prob > 0.3)  # Convert to Python bool
        result = {"detected": detected, "confidence": round(prob, 4)}
        source = "avg_wpm_rule" if behavior == "rapid_talking" else "PyTorch model"
        print(f"[{behavior}] RESULT: detected={detected}, confidence={prob:.4f} ({source})", file=sys.stderr)
        return result

    except Exception as exc:
        # Fall back gracefully
        result = {"detected": False, "confidence": 0.0, "error": str(exc)}
        print(f"[{behavior}] ERROR: {str(exc)} - returning fallback result", file=sys.stderr)
        return result


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
        # Ensure all values are JSON serializable
        if isinstance(result.get('detected'), np.bool_):
            result['detected'] = bool(result['detected'])
        if isinstance(result.get('confidence'), np.floating):
            result['confidence'] = float(result['confidence'])
            
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