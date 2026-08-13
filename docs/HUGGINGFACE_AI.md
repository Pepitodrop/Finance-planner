# Hugging Face financial intelligence

The application uses Hugging Face as an optional, server-side reasoning layer on top of deterministic financial calculations.

## Architecture

1. The browser or trusted backend builds an aggregated `FinancialSnapshot`.
2. Raw merchant descriptions, account names, transaction IDs, and credentials are excluded from the model prompt.
3. The server calls the Hugging Face OpenAI-compatible router with `HF_TOKEN` stored only in server configuration.
4. The model must return structured JSON.
5. The application validates signal types, evidence, confidence, text lengths, and approval requirements.
6. Invalid output, timeouts, provider errors, or unavailable models fall back to deterministic rules.

## Connectivity-aware routing

The steps above only run when the Finance Assistant has actually decided to call the hosted model. Hosted reasoning is the default while online, but the app automatically routes to the on-device model when offline, when the connection is reported degraded, or when the Network Information API reports a materially slow connection — and it never silently falls back to hosted AI if the on-device model can't load.

```mermaid
graph TD
  Start["User opens Finance Assistant"] --> Online{"navigator.onLine?"}
  Online -- "false" --> AutoLocal
  Online -- "true" --> HealthProbe{"Connectivity probe reports<br/>degraded or offline?"}
  HealthProbe -- "yes" --> AutoLocal
  HealthProbe -- "no" --> SlowCheck{"Slow connection?<br/>2g/slow-2g, downlink under 1.25,<br/>rtt 900 or more, or saveData"}
  SlowCheck -- "yes" --> AutoLocal["Automatic on-device routing<br/>hosted option disabled in UI,<br/>reason shown to user"]
  SlowCheck -- "no" --> UserChoice{"User's engine choice"}

  UserChoice -- "hosted (default while online)" --> ConsentGate
  UserChoice -- "on-device (manual, still allowed while online)" --> LocalRun

  ConsentGate{"consentExternalAi === true<br/>for this session?"} -- "no" --> ConsentBlocked["ai_consent_required<br/>request rejected"]
  ConsentGate -- "yes" --> HostedCall["Hosted inference call<br/>aggregate FinancialSnapshot only —<br/>no raw descriptions/account names/IDs<br/>⚠️ NOT provider/production verified,<br/>see Provider Status"]

  AutoLocal --> LocalRun["On-device inference<br/>Transformers.js / ONNX Runtime"]
  LocalRun -- "model can't load" --> Deterministic["Deterministic local calculations<br/>never silently calls hosted AI"]

  style HostedCall fill:#fde2e2,stroke:#b00020,color:#333
  style ConsentBlocked fill:#f5f5f5,stroke:#888,color:#333
```

Source: [`diagrams/ai-assistant-routing.mmd`](../diagrams/ai-assistant-routing.mmd).

## Default model

`Qwen/Qwen3-4B-Thinking-2507:fastest` is the default reasoning model. The model ID is configurable so production deployments can pin an approved model or use a different Hugging Face Inference Provider policy.

## Required environment

```bash
HF_TOKEN=hf_...
```

Never expose `HF_TOKEN` through Vite variables or client-side bundles.

## Safety and quality controls

- recommendations never execute financial actions;
- every suggested action remains approval-gated;
- only predefined signal types are accepted;
- confidence is clamped to the range 0–1;
- model output cannot override deterministic balances or transaction totals;
- malformed or unavailable inference degrades to a deterministic result;
- production rollout should log latency, fallback rate, schema failures, model ID, and user feedback without logging raw financial descriptions.

## Production follow-up

- expose the transport through an authenticated server endpoint;
- add per-user rate limits and request budgets;
- pin an evaluated model revision;
- run the frozen AI evaluation suite against German and English financial scenarios;
- add model drift, fallback-rate, and hallucination alerts;
- require explicit user consent before any aggregated financial snapshot is sent to an external inference provider.
