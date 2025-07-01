import torch
import os
import sys

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

try:
    # Try to import from ml-models directory
    ml_models_path = os.path.join(os.path.dirname(__file__), "..", "ml-models")
    sys.path.insert(0, ml_models_path)
    from architectures import WPMModel, EyeGazeLSTM, SitStandLSTM, TappingCNN
    print("Successfully imported model architectures", file=sys.stderr)
except ImportError as e:
    print(f"Failed to import architectures: {e}", file=sys.stderr)
    print(f"Current working directory: {os.getcwd()}")
    print(f"Project root: {project_root}")
    print(f"ML models path: {ml_models_path}")
    print(f"Python path: {sys.path}")
    raise

def load_all_models():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}", file=sys.stderr)

    # Map backend behavior_type -> model instance
    models = {
        "rapid_talking": WPMModel(),
        "eye_gaze": EyeGazeLSTM(),
        "sit_stand": SitStandLSTM(),
        "tapping_feet": TappingCNN(),
        "tapping_hands": TappingCNN(),
    }

    # Corresponding weight files (relative to ml-models directory)
    models_dir = os.path.join(os.path.dirname(__file__), "..", "ml-models")
    model_files = {
        "rapid_talking": os.path.join(models_dir, "rapid_talking.pth"),
        "eye_gaze": os.path.join(models_dir, "eye_gaze.pth"),
        "sit_stand": os.path.join(models_dir, "sit-stand.pth"),
        "tapping_feet": os.path.join(models_dir, "tapping_feet.pth"),
        "tapping_hands": os.path.join(models_dir, "tapping_hands.pth"),
    }

    # Load weights and move to device
    for key, model_path in model_files.items():
        try:
            mdl = models[key].to(device)
            if os.path.exists(model_path):
                mdl.load_state_dict(torch.load(model_path, map_location=device))
                print(f"Loaded {key} model from {model_path}", file=sys.stderr)
            else:
                print(f"Warning: Model file not found: {model_path}", file=sys.stderr)
        except Exception as e:
            print(f"Error loading {key} model: {e}", file=sys.stderr)

    # Set all models to evaluation mode
    for model in models.values():
        model.eval()

    return models