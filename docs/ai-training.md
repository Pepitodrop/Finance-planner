# Hugging Face training workflow

Finance Planner should not fine-tune a model merely because training is possible. A trained classifier is only promoted when it beats the existing rules + behavior graph + embedding ensemble on held-out, user-confirmed transactions.

## Privacy boundary

Training data is created only from categories explicitly confirmed by the user. The export helper removes IBAN-like strings, long references, and email addresses. The export stays local until the user deliberately uploads it to a private Hugging Face dataset or trains locally.

Never commit real transaction exports to this repository.

## Minimum dataset gate

The application checks for:

- at least 200 unique confirmed examples overall;
- at least 20 examples per represented category;
- at least three represented categories;
- a stratified validation split containing every category.

These are minimum engineering gates, not a guarantee of quality. More diverse examples are preferable.

## Export format

Hugging Face AutoTrain text classification expects `text` and `target` columns. Use `buildTrainingExamples`, `splitTrainingExamples`, and `toAutoTrainJsonl` from `src/trainingData.ts` to create:

- `training/data/train.jsonl`
- `training/data/validation.jsonl`

Each line has this form:

```json
{"text":"REWE Markt Karlsruhe","target":"Lebensmittel"}
```

## Train locally with Hugging Face AutoTrain

Install AutoTrain in an isolated Python environment, then run:

```bash
autotrain --config training/autotrain.yaml
```

The supplied configuration starts from `distilbert/distilbert-base-multilingual-cased`, uses a short sequence length suitable for transaction descriptions, evaluates every epoch, and applies early stopping.

## Promotion criteria

A candidate model must be evaluated on the untouched validation split and should satisfy all of the following before being added to `src/aiModels.ts`:

1. Macro F1 is higher than the current ensemble.
2. No important category loses more than five percentage points of recall.
3. Expected calibration error is acceptable, so confidence is meaningful.
4. The quantized ONNX model fits the intended browser or server memory budget.
5. The model card records dataset origin, languages, category taxonomy, metrics, limitations, and license.

If those conditions are not met, keep the current ensemble and collect better labels instead of adding another model.
