# Mobile / PWA / Android

## PWA

`public/sw.js` — service worker, `SHELL_CACHE_NAME = 'finance-planner-shell-v7'`, `RUNTIME_CACHE_NAME = 'finance-planner-runtime-v3'`. Precaches app shell on install, prunes stale `finance-planner-*` caches on activate, bounded runtime cache with trimming, navigation timeout fallback. `public/manifest.webmanifest` provides installability. Supported delivery: installable on iOS and Android as a PWA; web/PWA on Linux/Windows/macOS (no dedicated desktop packages yet).

## Android (Trusted Web Activity)

`android/` — package ID `de.luisbenedikt.financeplanner`, targets Android 16/API 36, min Android 6/API 23. It's a **TWA over the real browser origin**, not an embedded WebView — deliberate, so Google OAuth/passkeys work in the compatible browser context and the app reaches the same authenticated API/vault/cloud-state as web (see [[Architecture Decisions]]). Falls back to a secure Custom Tab until the production signing cert is deployed via Digital Asset Links.

Build: `cd android && gradle --no-daemon :app:lintDebug :app:testDebugUnitTest :app:assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`. `.github/workflows/android.yml` builds this debug APK on every relevant PR/main push (build verification only, not device/store verification).

## Signing status

No committed keystore (repo policy: never commit one). Debug builds use Android's development key. Release signing needs 5 GitHub secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_SHA256_CERT_FINGERPRINT`) — whether these are actually configured in the GitHub org was not verifiable from a filesystem inspection. `public/.well-known/assetlinks.json` is **intentionally empty** until a permanent signing cert exists (`docs/ANDROID.md`) — Digital Asset Links verification is not yet live.

## Physical-device / Play Store evidence

`docs/NON_DESKTOP_READINESS.md` is explicit: "Physical-device tests, Android signing and store publication, live bank certification, production-token model evidence, independent accessibility validation, penetration testing and production restore drills remain separate dependencies... No repository change alone can honestly certify a physical phone... an app-store identity." `docs/ANDROID.md`'s Play release checklist still lists physical-device testing as a manual pre-publication step.

Verification state: TWA architecture and offline-capable PWA shell — **implemented**. Release signing — **mechanism exists, execution not confirmed**. Physical-device testing / Play Store publication — **not done / no evidence found.**

Related: [[Architecture Decisions]], [[Known Issues and Limitations]]
