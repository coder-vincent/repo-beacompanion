"""Model architecture definitions extracted from training notebooks.

These classes re-implement the exact layer structures that were present in the
training notebooks when the .pth weight files in `machine-learning/models/` were
saved.  They are deliberately **simple** and do not contain any training code –
only the forward pass needed for inference in production.
"""

from __future__ import annotations

import torch
import torch.nn as nn
from torchvision import models

__all__ = [
    "EyeGazeLSTM",
    "TappingCNN",
    "SitStandLSTM",
    "WPMModel",
]


# ---------------------------------------------------------------------------
# 1. Eye-gaze direction – MobileNetV2 backbone + LSTM
# ---------------------------------------------------------------------------


class EyeGazeLSTM(nn.Module):
    """Image-sequence classifier for 5 gaze directions."""

    def __init__(self, hidden_dim: int = 128, num_classes: int = 5, *, lstm_layers: int = 1):
        super().__init__()
        mobilenet = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.DEFAULT)
        self.feature_extractor = mobilenet.features  # (N, 1280, H/32, W/32)
        self.pool = nn.AdaptiveAvgPool2d((1, 1))

        # Freeze backbone features for inference
        for p in self.feature_extractor.parameters():
            p.requires_grad = False

        self.lstm = nn.LSTM(
            input_size=1280,
            hidden_size=hidden_dim,
            num_layers=lstm_layers,
            batch_first=True,
        )
        self.classifier = nn.Linear(hidden_dim, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x shape: (B, T, C, H, W)
        b, t, c, h, w = x.shape
        x = x.view(-1, c, h, w)  # (B*T, C, H, W)
        with torch.no_grad():
            feats = self.feature_extractor(x)
            feats = self.pool(feats).view(feats.size(0), -1)  # (B*T, 1280)
        feats = feats.view(b, t, -1)  # (B, T, 1280)
        lstm_out, _ = self.lstm(feats)
        return self.classifier(lstm_out[:, -1, :])  # (B, num_classes)


# ---------------------------------------------------------------------------
# 2. Tapping detection – MobileNetV2 backbone + LSTM (binary)
# ---------------------------------------------------------------------------


class TappingCNN(nn.Module):
    """Shared architecture for hand/foot tapping binary classifiers."""

    def __init__(self, hidden_dim: int = 128):
        super().__init__()
        mobilenet = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.DEFAULT)
        self.feature_extractor = mobilenet.features
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        for p in self.feature_extractor.parameters():  # freeze
            p.requires_grad = False
        self.lstm = nn.LSTM(1280, hidden_dim, batch_first=True)
        self.classifier = nn.Linear(hidden_dim, 2)  # binary (no-tap, tap)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, t, c, h, w = x.shape
        x = x.view(-1, c, h, w)
        with torch.no_grad():
            x = self.feature_extractor(x)
            x = self.pool(x).view(x.size(0), -1)
        x = x.view(b, t, -1)
        lstm_out, _ = self.lstm(x)
        return self.classifier(lstm_out[:, -1])


# ---------------------------------------------------------------------------
# 3. Sit/stand pose classifier – pure LSTM over key-point sequences
# ---------------------------------------------------------------------------


class SitStandLSTM(nn.Module):
    """Sequence classifier over pose key-points."""

    def __init__(
        self,
        input_size: int = 33 * 2,  # MediaPipe pose gives 33 (x,y)
        hidden_size: int = 128,
        num_classes: int = 2,
        num_layers: int = 2,
        bidirectional: bool = True,
        dropout: float = 0.4,
    ) -> None:
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=bidirectional,
            dropout=dropout,
        )
        self.fc = nn.Linear(hidden_size * 2 if bidirectional else hidden_size, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x shape: (B, T, input_size)
        out, _ = self.lstm(x)
        return self.fc(out[:, -1, :])


# ---------------------------------------------------------------------------
# 4. Rapid talking (WPM) – simple 1-D LSTM binary classifier
# ---------------------------------------------------------------------------


class WPMModel(nn.Module):
    """1-D LSTM that takes a sequence of single-feature values (WPM)."""

    def __init__(self):
        super().__init__()
        self.lstm = nn.LSTM(1, 16, batch_first=True)
        self.fc = nn.Linear(16, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x shape: (B, T, 1)
        out, _ = self.lstm(x)
        return torch.sigmoid(self.fc(out[:, -1, :])) 