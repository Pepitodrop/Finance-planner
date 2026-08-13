---
type: page
domain: ai
status: implemented
---

# Receipt Review (page)

Secondary nav, "Intelligence" group. On-device receipt/invoice field extraction and review before a transaction is created from it.

- **Component:** `src/ReceiptReview.tsx`
- **Logic:** `src/receiptReview.ts`
- **Model:** [[Model receipt]] (`Xenova/donut-base-finetuned-cord-v2`, image-to-text, on-demand, fp16) — entirely on-device, no hosted call
- **Backend counterpart:** [[receipt-intelligence.js]] (server-side receipt intelligence support, if/when used server-side)
- **Related tests:** `src/receiptReview.test.ts`, `src/ReceiptReview.test.tsx`
- **Privacy:** on-device extraction avoids sending receipt images to any external provider

Related: [[AI System]] · [[Finance Assistant Page]]
