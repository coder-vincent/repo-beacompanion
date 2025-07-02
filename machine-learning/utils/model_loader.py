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

    # Corresponding weight files (relative to utils directory)
    model_files = {
        "rapid_talking": "../models/rapid_talking.pth",
        "eye_gaze": "../models/eye_gaze.pth",
        "sit_stand": "../models/sit-stand.pth",
        "tapping_feet": "../models/tapping_feet.pth",
        "tapping_hands": "../models/tapping_hands.pth",
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