import torch
import os
import sys

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

try:
    from models.architectures import WPMModel, EyeGazeLSTM, SitStandLSTM, TappingCNN
    print("Successfully imported model architectures", file=sys.stderr)
except ImportError as e:
    print(f"Failed to import architectures: {e}", file=sys.stderr)
    print(f"Current working directory: {os.getcwd()}")
    print(f"Project root: {project_root}")
    print(f"Python path: {sys.path}")
    raise

# -----------------------------
# Lazy per-behaviour model loader
# -----------------------------

# Map behaviour -> (model_class, weight_path).  Defined once so both
# load_model() and (legacy) load_all_models() share the same source of truth.

_MODEL_CLASSES = {
    "rapid_talking": WPMModel,
    "eye_gaze": EyeGazeLSTM,
    "sit_stand": SitStandLSTM,
    "tapping_feet": TappingCNN,
    "tapping_hands": TappingCNN,
}

_models_dir = os.path.join(os.path.dirname(__file__), "..", "ml-models")
_MODEL_WEIGHTS = {
    "rapid_talking": os.path.join(_models_dir, "rapid_talking.pth"),
    "eye_gaze": os.path.join(_models_dir, "eye_gaze.pth"),
    "sit_stand": os.path.join(_models_dir, "sit-stand.pth"),
    "tapping_feet": os.path.join(_models_dir, "tapping_feet.pth"),
    "tapping_hands": os.path.join(_models_dir, "tapping_hands.pth"),
}

# In-process cache so subsequent calls reuse the same model instead of
# re-loading weights (saves both time and memory when the Python worker is
# reused).
_model_cache: dict[str, torch.nn.Module] = {}

def load_model(behavior: str) -> torch.nn.Module:
    """Load **one** model for the given behaviour type.

    Caches the instance so repeated calls for the same behaviour return the
    already-loaded version.  Raises ``ValueError`` if the behaviour is
    unsupported.
    """

    if behavior not in _MODEL_CLASSES:
        raise ValueError(f"Unsupported behaviour type: {behavior}")

    if behavior in _model_cache:
        return _model_cache[behavior]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model_cls = _MODEL_CLASSES[behavior]
    model = model_cls().to(device)

    weight_path = _MODEL_WEIGHTS.get(behavior)
    try:
        if weight_path and os.path.exists(weight_path):
            model.load_state_dict(torch.load(weight_path, map_location=device))
            print(f"Loaded {behavior} weights from {weight_path}", file=sys.stderr)
        else:
            print(f"Weight file for {behavior} not found – using random weights", file=sys.stderr)
    except Exception as exc:
        print(f"Error loading weights for {behavior}: {exc}", file=sys.stderr)

    model.eval()
    _model_cache[behavior] = model
    return model

# ---------------------------------------------------------------------------
# Backwards-compatibility helper: load **all** models (original behaviour)
# ---------------------------------------------------------------------------

def load_all_models() -> dict[str, torch.nn.Module]:
    """Load every model and return a behaviour->model mapping.

    Note: This eagerly allocates a large amount of GPU/CPU RAM and should be
    avoided for production inference.  Prefer :func:`load_model` instead.
    """

    for beh in _MODEL_CLASSES.keys():
        try:
            load_model(beh)
        except Exception:
            # Individual failures are logged inside load_model – continue so the
            # caller gets as many models as possible.
            continue
    return _model_cache