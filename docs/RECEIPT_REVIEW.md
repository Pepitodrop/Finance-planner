# Sustainable receipt review

The **Beleg-Check** accepts a grocery receipt image and returns an estimated shopping score focused on:

- affordability: 25%;
- BIO and Fairtrade choices: 40%;
- environmental impact: 35%.

The connector calculates the final score deterministically from the three validated sub-scores. The vision model does not control the weighting.

## Model and routing

The hosted implementation uses the open-weight Hugging Face model identifier:

```text
Qwen/Qwen2.5-VL-7B-Instruct:fastest
license Apache-2.0
routing Hugging Face provider-managed
```

The exact provider-routed model identifier is allowlisted in `server/src/receipt-intelligence.js`. The `:fastest` route lets Hugging Face select an available inference provider and does **not** prove that a particular immutable repository commit served the request. A deployment requiring commit-level runtime pinning must use a dedicated or self-hosted endpoint and provide separate deployment evidence.

Open weights are free to self-host. Hugging Face Inference Provider quota or provider charges may still apply to hosted execution.

## Privacy and request lifecycle

1. The user selects a JPEG, PNG, or WebP image.
2. The browser removes the original metadata by drawing the image to a canvas.
3. The browser scales the image to at most 1600 pixels per side and compresses it to JPEG at no more than 650 KB.
4. Consent is bound to the currently selected image only.
5. Consent is consumed as soon as analysis starts and is reset whenever the image changes, so every external upload requires a fresh user action.
6. Selecting a new image aborts an active request. A sequence guard discards any stale response that arrives for an older image.
7. The authenticated connector validates the declared MIME type, Base64 encoding, image signature, and decoded size.
8. The image is sent once to Hugging Face and is not written to Finance Planner storage, application logs, PostgreSQL, backups, or the browser vault.
9. Only the validated structured result is displayed. It is not automatically turned into a transaction.

Do not upload receipts containing information that should not be shared with the configured inference provider.

## Evidence and abstention policy

A score is displayed only when all deterministic evidence gates pass:

- overall model confidence is at least `0.50`;
- at least one priced item is extracted with confidence of at least `0.55`.

When either gate fails, the server returns `evidenceStatus: "insufficient"` and deliberately removes:

- the overall score;
- all sub-scores;
- merchant and total claims;
- product assessments;
- recommendations and alternatives.

The UI then asks the user for a clearer photograph rather than presenting a confident-looking result from weak evidence.

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

1. Upload a clear grocery receipt and confirm fresh consent is required.
2. Start analysis, then confirm the checkbox is cleared and a second analysis requires new consent.
3. Change the image during an active request and confirm the old request is aborted or its result is discarded.
4. Verify the result contains only products visible on the receipt.
5. Compare every extracted price and the receipt total with the image.
6. Confirm unknown BIO or Fairtrade status is not shown as confirmed.
7. Confirm store and savings suggestions are labelled as estimates.
8. Upload a blurred or empty receipt and confirm no score or recommendations are displayed.
9. Upload JPEG, PNG, and WebP images.
10. Try a PDF, text file, mismatched extension, malformed Base64, and oversized image; all must be rejected.
11. Inspect logs and PostgreSQL to confirm receipt images are not stored.
12. Test the real Hugging Face route with the production token and verify image input plus strict JSON-schema output are supported.
13. Test Android camera capture, iOS camera capture, Firefox, Chrome, and Safari.
