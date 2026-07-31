import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const paths = [
  'android/app/build.gradle.kts',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/res/values/strings.xml',
  'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  'android/gradle/wrapper/gradle-wrapper.properties',
  '.github/workflows/android.yml',
  'public/.well-known/assetlinks.json',
  'docs/ANDROID.md',
]

const files = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(path, 'utf8')])))
const build = files['android/app/build.gradle.kts']
const manifest = files['android/app/src/main/AndroidManifest.xml']
const strings = files['android/app/src/main/res/values/strings.xml']
const icon = files['android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml']
const workflow = files['.github/workflows/android.yml']
const assetlinks = JSON.parse(files['public/.well-known/assetlinks.json'])

assert.match(build, /applicationId = "de\.luisbenedikt\.financeplanner"/)
assert.match(build, /compileSdk = 36/)
assert.match(build, /targetSdk = 36/)
assert.match(build, /minSdk = 23/)
assert.match(build, /androidbrowserhelper:2\.6\.2/)
assert.match(build, /isMinifyEnabled = true/)
assert.match(build, /ANDROID_KEYSTORE_PATH/)
assert.match(build, /"OldTargetApi"/, 'A preview SDK must not silently change the validated production target')
assert.match(manifest, /com\.google\.androidbrowserhelper\.trusted\.LauncherActivity/)
assert.match(manifest, /android:autoVerify="true"/)
assert.match(manifest, /android:allowBackup="false"/)
assert.match(manifest, /android:usesCleartextTraffic="false"/)
assert.match(manifest, /android\.support\.customtabs\.trusted\.DEFAULT_URL/)
assert.match(strings, /https:\/\/finance\.luisbenedikt\.de\/\?source=android-app/)
assert.match(icon, /<monochrome /, 'Adaptive icon must support Android themed icons')
assert.doesNotMatch(manifest, /WebView|android\.webkit/, 'The Android package must use the browser-backed TWA, not an embedded WebView')
assert.match(files['android/gradle/wrapper/gradle-wrapper.properties'], /gradle-9\.6\.1-bin\.zip/)
assert.match(workflow, /gradle-version: '9\.6\.1'/)
assert.match(workflow, /assembleDebug/)
assert.match(workflow, /bundleRelease/)
assert.match(workflow, /android-debug-apk/)
assert.match(workflow, /ANDROID_KEYSTORE_BASE64/)
assert.ok(Array.isArray(assetlinks), 'assetlinks.json must contain a JSON array')
if (assetlinks.length > 0) {
  assert.equal(assetlinks[0]?.target?.package_name, 'de.luisbenedikt.financeplanner')
  assert.ok(Array.isArray(assetlinks[0]?.target?.sha256_cert_fingerprints))
}
assert.match(files['docs/ANDROID.md'], /Trusted Web Activity/)
assert.match(files['docs/ANDROID.md'], /Google Play/)

console.log('Android native application invariants verified.')
