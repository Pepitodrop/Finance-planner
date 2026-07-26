# Behavior graph model training

The application starts with encrypted graph edges, multilingual E5 embeddings, and adaptive bandit scoring. This folder adds an optional offline graph-edge classifier for the point at which enough confirmed behavior exists.

## Why it is not automatically trained

Financial behavior data is private, user-specific, and initially sparse. Training on a tiny graph would overfit and could make the app less reliable. The app therefore exports anonymized, explicitly confirmed examples only after user action.

## Minimum promotion gate

- At least 200 unique confirmed graph edges
- At least 40 held-out validation examples
- No raw IBANs, account references, email addresses, or unredacted free text
- Validation accuracy of at least 0.75
- Must outperform the existing E5 plus adaptive-edge baseline on the same split
- Per-category recall and confidence calibration must be reviewed before deployment

## Training

```bash
python training/gnn/train_behavior_gnn.py --data private/behavior_edges.jsonl --output artifacts/behavior-gnn
```

The output remains local. Uploading artifacts to the Hugging Face Hub must be a separate explicit operation with a private repository and a reviewed model card.

## Runtime plan

The browser continues using the cheap E5 retrieval baseline. A promoted graph model should run server-side or be converted to ONNX only after latency, model size, privacy, and accuracy checks pass. The model may rank candidate merchant-category edges; it must never execute payments, transfers, subscriptions, or account changes.
