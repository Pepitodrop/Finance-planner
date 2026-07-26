"""Train an optional behavior-graph classifier and publish it to Hugging Face only when explicitly enabled.

Expected JSONL rows:
{"merchant_embedding": [..], "category_id": 2, "confirmations": 4, "recency_days": 3, "label": 1}

This script intentionally trains offline. It never reads application storage or uploads user data automatically.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset, random_split


class GraphEdgeDataset(Dataset):
    def __init__(self, path: Path) -> None:
        self.rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if len(self.rows) < 200:
            raise ValueError("At least 200 anonymized confirmed graph edges are required.")

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        row = self.rows[index]
        features = list(row["merchant_embedding"]) + [
            float(row.get("confirmations", 0)),
            float(row.get("recency_days", 0)),
        ]
        return torch.tensor(features, dtype=torch.float32), torch.tensor(int(row["label"]), dtype=torch.long)


class EdgeClassifier(nn.Module):
    def __init__(self, input_size: int, classes: int) -> None:
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_size, 128), nn.ReLU(), nn.Dropout(0.15),
            nn.Linear(128, 64), nn.ReLU(), nn.Linear(64, classes),
        )

    def forward(self, values):
        return self.network(values)


def train(data_path: Path, output_dir: Path, epochs: int) -> None:
    dataset = GraphEdgeDataset(data_path)
    validation_size = max(40, int(len(dataset) * 0.2))
    train_set, validation_set = random_split(dataset, [len(dataset) - validation_size, validation_size], generator=torch.Generator().manual_seed(42))
    first_features, first_label = dataset[0]
    classes = max(int(row["label"]) for row in dataset.rows) + 1
    model = EdgeClassifier(first_features.numel(), classes)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=0.01)
    loss_fn = nn.CrossEntropyLoss()

    for _ in range(epochs):
        model.train()
        for features, labels in DataLoader(train_set, batch_size=32, shuffle=True):
            optimizer.zero_grad()
            loss = loss_fn(model(features), labels)
            loss.backward()
            optimizer.step()

    model.eval()
    correct = total = 0
    with torch.no_grad():
        for features, labels in DataLoader(validation_set, batch_size=64):
            predictions = model(features).argmax(dim=-1)
            correct += int((predictions == labels).sum())
            total += labels.numel()
    accuracy = correct / max(1, total)
    if accuracy < 0.75:
        raise RuntimeError(f"Candidate rejected: validation accuracy {accuracy:.3f} is below 0.75")

    output_dir.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "input_size": first_features.numel(), "classes": classes, "validation_accuracy": accuracy}, output_dir / "behavior-graph-model.pt")
    (output_dir / "metrics.json").write_text(json.dumps({"validation_accuracy": accuracy, "examples": len(dataset)}, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("artifacts/behavior-gnn"))
    parser.add_argument("--epochs", type=int, default=12)
    args = parser.parse_args()
    train(args.data, args.output, args.epochs)


if __name__ == "__main__":
    main()
