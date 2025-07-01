#!/usr/bin/env python3
"""Train or re-train the rapid-talking (WPM) classifier.

Usage
-----
python train_rapid_talking.py  # saves rapid_talking.pth next to the other models

The script expects a CSV at
machine-learning/models/speech/rapid_talking_data.csv
with at least two columns:
    wpm   – numeric words-per-minute value per utterance chunk
    label – 1 if "rapid talking", 0 otherwise
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, Dataset, Subset

ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "machine-learning" / "models" / "speech" / "rapid_talking_data.csv"
OUT_PATH = ROOT / "machine-learning" / "models" / "rapid_talking.pth"


class WPMSpeechDataset(Dataset):
    def __init__(self, df: pd.DataFrame):
        self.x = torch.tensor(df["wpm"].values, dtype=torch.float32).view(-1, 1, 1)
        self.y = torch.tensor(df["label"].values, dtype=torch.float32).view(-1, 1)

    def __len__(self):
        return len(self.x)

    def __getitem__(self, idx):
        return self.x[idx], self.y[idx]


class WPMModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.lstm = nn.LSTM(1, 16, batch_first=True)
        self.fc = nn.Linear(16, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        return torch.sigmoid(self.fc(out[:, -1, :]))


def main() -> None:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Training CSV not found: {CSV_PATH}")

    df = pd.read_csv(CSV_PATH)
    if not {"wpm", "label"}.issubset(df.columns):
        raise ValueError("CSV must contain 'wpm' and 'label' columns")

    # Train/val split
    train_idx, _ = train_test_split(
        range(len(df)), test_size=0.2, random_state=42, shuffle=True
    )

    dataset = WPMSpeechDataset(df)
    train_loader = DataLoader(
        Subset(dataset, train_idx), batch_size=16, shuffle=True, drop_last=False
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = WPMModel().to(device)
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=1e-2)

    epochs = 20
    for epoch in range(1, epochs + 1):
        model.train()
        total = 0.0
        for X, y in train_loader:
            X, y = X.to(device), y.to(device)
            optimizer.zero_grad()
            pred = model(X)
            loss = criterion(pred, y)
            loss.backward()
            optimizer.step()
            total += loss.item()
        print(f"Epoch {epoch:02d}: loss {total/len(train_loader):.4f}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), OUT_PATH)
    print("Model saved to", OUT_PATH)


if __name__ == "__main__":
    main() 