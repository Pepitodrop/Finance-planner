# Sustainable receipt review

The **Beleg-Check** accepts a grocery receipt image and returns an estimated shopping score focused on:

- affordability: 25%;
- BIO and Fairtrade choices: 40%;
- environmental impact: 35%.

The final score is calculated deterministically by the connector from the three validated sub-scores. The vision model does not control the weighting.

## Model

The hosted implementation uses the open-weight Hugging Face model:

```text
Qwen/Qwen2.5-VL-7B-Instruct:fastest
revision b901af65fa3b2801b73d1c5b1ff59b89d81a708f
license Apache-2.0
```

The model and immutable revision are allowlisted together in `server/src/receipt-intelligence.js`. Changing either requires a reviewed code change and new evaluation evidence.

Open weights are free to self-host. Hugging Face Inference Provider quota or provider charges may still apply to hosted execution.

## Privacy flow

1. The user selects a JPEG, PNG, or WebP image.
2. The browser removes the original metadata by drawing the image to a canvas.
3. The browser scales the image to at most 1600 pixels per side and compresses it to JPEG at no more than 650 KB.
4. The user must explicitly consent before upload.
5. The authenticated connector validates the declared MIME type, Base64 encoding, image signature, and decoded size.
6. The image is sent once to Hugging Face and is not written to Finance Planner storage, logs, PostgreSQL, backups, or the browser vault.
7. Only the validated structured result is displayed. It is not automatically turned into a transaction.

Do not upload receipts containing information that should not be shared with the configured inference provider.

## Accuracy boundary

The feature does **not** have a live supermarket price, promotion, inventory, product-label, seasonality, or supply-chain database. Therefore:

- recognized receipt prices may be used only when visible on the image;
- BIO, Fairtrade, regional, and seasonal labels are positive only when visible or unambiguous in the product name;
- unknown labels remain `null` rather than being guessed;
- cheaper products, replacement products, and alternative stores are estimates;
- the UI always displays the missing-live-data limitation.

Alternative store suggestions are limited to generic store types or illustrative examples such as discount supermarkets, organic supermarkets, weekly markets, farm shops, and zero-waste shops. They must not be presented as current offers or guaranteed availability.

## Endpoint

```http
POST /api/ai/receipt-review
Content-Type: application/json
```

The endpoint requires an authenticated session and the sensitive-route rate limit.

```json
{
  "consentExternalAi": true,
  "image": {
    "mimeType": "image/jpeg",
    "dataBase64": "..."
  },
  "preferences": {
    "country": "DE",
    "priorities": ["bio", "fairTrade", "eco", "price"]
  }
}
```

The request body remains below the connector's one-megabyte JSON limit. Images are rejected above 700 KB after Base64 decoding.

## Manual acceptance test

1. Upload a clear grocery receipt and confirm consent is required.
2. Verify the result contains only products visible on the receipt.
3. Compare every extracted price and the receipt total with the image.
4. Confirm unknown BIO or Fairtrade status is not shown as confirmed.
5. Confirm store and savings suggestions are labelled as estimates.
6. Upload a blurred receipt and verify the system reports uncertainty or rejects the result rather than inventing products.
7. Upload JPEG, PNG, and WebP images.
8. Try a PDF, text file, mismatched extension, malformed Base64, and oversized image; all must be rejected.
9. Inspect logs and PostgreSQL to confirm receipt images are not stored.
10. Test on Android camera capture, iOS camera capture, Firefox, Chrome, and Safari.
