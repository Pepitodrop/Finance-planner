import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Step 14: guards the specific mounted, user-facing runtime/chrome surfaces
// that were migrated from German to English against reintroducing the exact
// obsolete strings that used to be there. Deliberately scoped to files known
// to render real product chrome -- NOT a whole-repo German-word scan, which
// would false-positive on legitimate German bank CSV/CAMT column names
// (statementImport.ts), merchant-name normalization (recurringDetection.ts,
// transactionClassification.ts), the German demo/sample dataset (data.ts,
// ReceiptReview.tsx), and the AI category-keyword taxonomy (ai.ts) -- all of
// which are correctly untranslated technical necessities or deliberate
// localized example data, not chrome.
const FORBIDDEN_BY_FILE = {
  'index.html': ['lang="de"', 'benötigt JavaScript'],
  'public/manifest.webmanifest': ['de-DE', 'Finanzübersicht', 'Transaktionen öffnen', 'Neue Buchung'],
  'src/MobileRuntime.tsx': ['Offline-Modus', 'Gerätespeicher', 'Jetzt aktualisieren', 'installieren', 'Home-Bildschirm', 'Daten schützen'],
  'src/MobileConnectivityStatus.tsx': ['Netzwerkverbindung', 'Erneut versuchen'],
  'src/WebMobileHardening.tsx': ['Zum Hauptinhalt springen', 'geöffnet', 'neue Version ist verfügbar'],
  'src/FrontendExperience.tsx': ['Finanzdiagramm', 'wurde gespeichert', 'Finance Planner Anwendung'],
  'src/ErrorBoundary.tsx': ['Unerwarteter Fehler', 'konnte nicht weiterlaufen', 'neu laden'],
  'src/TestEnrollmentPage.tsx': ['Einladungslink', 'Testzugang', 'Passkey einrichten', 'eingerichtet'],
  'src/MobileEnhancements.tsx': ['wird geladen"'],
  'src/aiRuntimeReadiness.ts': ['Modell wird beim Start', 'Server-Workload', 'Hugging-Face-Modelle'],
  'src/bankIntelligence.ts': ['Buchungen benötigen', 'Buchungen haben schwache', 'Buchungen enthalten ungültige', 'importierbaren Buchungen'],
  'src/budgetPlan.ts': ['Budgetdienst', 'Lernprofil', 'Rückmeldung konnte'],
  'src/connectors.ts': ['Banking-Backend', 'Sync-Dienst lieferte', 'Weiterleitungsadresse'],
  'src/infrastructure/persistence/cloudState.ts': ['Cloud-Datenstand', 'Cloud-Speicherbestätigung'],
  'src/infrastructure/persistence/storage.ts': ['Cloud-Speicher wurde', 'Cloud-Speicher nicht erreichbar', 'lokale Vault ist nicht entsperrt'],
  'src/transactionState.ts': ['zu löschende Transaktion', 'zu bearbeitende Transaktion'],
}

const results = []
for (const [path, forbidden] of Object.entries(FORBIDDEN_BY_FILE)) {
  const content = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  for (const marker of forbidden) {
    assert.ok(!content.includes(marker), `${path} must not reintroduce the obsolete German runtime string ${JSON.stringify(marker)}`)
  }
  results.push(path)
}

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8')
assert.match(index, /<html lang="en">/)
const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'))
assert.equal(manifest.lang, 'en-US')

console.log(`English runtime chrome guard passed: ${results.length} files checked, root lang=en, manifest lang=en-US.`)
