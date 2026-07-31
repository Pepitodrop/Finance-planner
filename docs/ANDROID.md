# Android application

Finance Planner ships an Android project in `android/`. It is a browser-backed **Trusted Web Activity (TWA)**, not an embedded `WebView`.

That choice is deliberate:

- Google OAuth and passkeys run in the user's normal compatible browser context;
- cookies, service-worker storage and the existing encrypted device vault retain normal web-origin semantics;
- the Android package uses the same authenticated `/api/finance/state` API and PostgreSQL account data as every other client;
- the browser runtime is updated independently of the APK;
- if Digital Asset Links verification is unavailable, the app remains usable through the secure Custom Tab fallback.

The package name is `de.luisbenedikt.financeplanner`. The application targets Android 16 / API level 36 and supports Android 6 / API level 23 and newer.

## Build an installable APK

Use Android Studio with JDK 17, or install Gradle 9.6.1 and Android SDK platform 36/build-tools 36.0.0:

```bash
cd android
gradle --no-daemon :app:lintDebug :app:testDebugUnitTest :app:assembleDebug
```

The installable file is:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a USB-connected device:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions also builds this APK on every relevant pull request and `main` update. Download the `android-debug-apk` workflow artifact to test without installing Android Studio.

A debug build is signed with Android's development key. Until its certificate is listed in the deployed `assetlinks.json`, Chrome displays the site in the Custom Tab fallback rather than removing all browser chrome. Authentication, encrypted cloud data and normal app functionality still work.

## Release signing

Never commit a keystore or password. Create a long-lived upload key and protect it outside the repository:

```bash
keytool -genkeypair -v \
  -keystore finance-planner-upload.jks \
  -alias finance-planner \
  -keyalg RSA -keysize 4096 -validity 10000
```

Read its SHA-256 certificate fingerprint:

```bash
keytool -list -v \
  -keystore finance-planner-upload.jks \
  -alias finance-planner
```

Configure these GitHub Actions secrets:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded `.jks` file |
| `ANDROID_KEY_ALIAS` | Keystore alias |
| `ANDROID_STORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_PASSWORD` | Key password |
| `ANDROID_SHA256_CERT_FINGERPRINT` | Colon-separated SHA-256 fingerprint |

Encode the keystore without line wrapping:

```bash
base64 -w 0 finance-planner-upload.jks
```

On macOS use:

```bash
base64 < finance-planner-upload.jks | tr -d '\n'
```

When all signing secrets exist, the Android workflow additionally produces:

- `app-release.apk` for direct installation;
- `app-release.aab` for Google Play;
- the verified certificate report;
- a generated `assetlinks.json` matching the release certificate.

## Digital Asset Links and fullscreen mode

The repository intentionally contains an empty `public/.well-known/assetlinks.json` until the permanent signing certificate exists. This prevents a placeholder or incorrect certificate from being deployed as a trusted association.

Generate the production file with the real certificate fingerprint:

```bash
ANDROID_SHA256_CERT_FINGERPRINT='AA:BB:...:FF' \
  npm run android:assetlinks
```

Multiple certificates can be supplied as a comma-separated list during a signing-key transition. Commit and deploy the generated file, then verify:

```bash
curl -fsS https://finance.luisbenedikt.de/.well-known/assetlinks.json
adb shell pm verify-app-links --re-verify de.luisbenedikt.financeplanner
adb shell pm get-app-links de.luisbenedikt.financeplanner
```

The certificate in `assetlinks.json` must match the certificate that signs the installed APK. When Google Play App Signing is enabled, add the **Play app-signing certificate** as well as the upload certificate where appropriate.

## Local signed build

```bash
cd android
ANDROID_KEYSTORE_PATH="$PWD/../finance-planner-upload.jks" \
ANDROID_KEY_ALIAS='finance-planner' \
ANDROID_STORE_PASSWORD='...' \
ANDROID_KEY_PASSWORD='...' \
gradle --no-daemon :app:lintRelease :app:assembleRelease :app:bundleRelease
```

The release build enables R8 code shrinking and resource shrinking. `apksigner verify --verbose --print-certs` must pass before distribution.

## Google Play release checklist

1. Reserve package `de.luisbenedikt.financeplanner` in Play Console.
2. Enable Play App Signing and archive both the upload and app-signing fingerprints.
3. Deploy `assetlinks.json` with the production fingerprints.
4. Upload `app-release.aab` to the internal testing track.
5. Complete the Data safety form accurately. The native shell itself stores no finance database; authenticated finance data remains in the encrypted web vault and PostgreSQL service described in `docs/CLOUD_DATA.md`.
6. Supply privacy-policy and support URLs.
7. Test Google OAuth, passkey login, vault creation/unlock, offline reload, cloud synchronization, conflict resolution and bank callbacks on physical devices.
8. Run Play pre-launch reports and resolve crashes, accessibility defects and security warnings before wider distribution.

## Security boundaries

- Only HTTPS is allowed; cleartext traffic is disabled.
- Android cloud backup and device-transfer backup are disabled for the native shell.
- The package requests only internet access.
- The app does not embed credentials, provider tokens or database secrets.
- The TWA cannot directly read the browser's cookies or local storage. It relies on the same-origin web application and authenticated backend.
- The APK is not a substitute for PostgreSQL backups or the user's encrypted finance backup.

## Updating the app

Increase `versionCode` for every uploaded Play bundle and update `versionName` for user-visible releases in `android/app/build.gradle.kts`. Keep `targetSdk`, AGP, Gradle, Android Browser Helper and the Android workflow current, then rebuild both the debug APK and signed AAB.
