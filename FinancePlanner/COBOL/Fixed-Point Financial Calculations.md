---
type: component
domain: cobol
status: implemented
---

# Fixed-Point Financial Calculations

All arithmetic crossing the COBOL boundary is integer-cents; no binary floating point. Provider decimal strings (e.g. `"12.99"`) are converted to cents by the Node adapter *before* entering COBOL — the COBOL side never parses provider-formatted decimals directly.

- **Decision record:** [[Architecture Decisions]] — "Money is represented as integer cents everywhere"

Related: [[COBOL Index]] · [[Banking Core Module]] · [[Architecture Decisions]]
