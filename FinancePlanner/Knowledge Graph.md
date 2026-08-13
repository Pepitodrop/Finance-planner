# Knowledge Graph

This note is the relationship-centric map of Finance Planner memory. [[00 Project Index]] is the directory-style entry point; this note is for navigating **how concepts affect one another**.

The graph should grow as a connected knowledge network, not as a collection of independent documents or a single hub with many leaves.

## Core architecture spine

[[System Architecture]] is shaped by and connects the main implementation boundaries:

- [[Frontend]] depends on the contracts and persistence behavior described in [[Data and Persistence]].
- [[Backend]] orchestrates [[Authentication]], [[Bank Connections]], [[PayPal]], [[AI System]], and the [[COBOL Domain Core]].
- [[COBOL Domain Core]] constrains deterministic finance behavior across [[Bank Connections]], manual finance calculations, and the AI boundary in [[AI System]].
- [[Data and Persistence]] connects application state, [[Sync and Offline]], [[Authentication]], and production storage concerns in [[Deployment]].

## Security and identity cluster

[[Authentication]] → depends on → [[Backend]] and [[Data and Persistence]]

[[Authentication]] → constrained by → [[Security Decisions]]

[[Security Decisions]] → operationalized by → [[Security]] and [[Deployment]]

[[Authentication]] → verification state recorded in → [[Provider Status]]

This cluster should stay connected to provider and deployment knowledge because authentication correctness is partly implementation, partly runtime/environment evidence.

## Banking and provider cluster

[[Bank Connections]] → validated by → [[COBOL Domain Core]]

[[Bank Connections]] → provider evidence recorded in → [[Provider Status]]

[[PayPal]] → shares provider/security constraints with → [[Bank Connections]]

[[PayPal]] → verification state recorded in → [[Provider Status]]

[[Provider Status]] → constrained by evidence rules from → [[Memory System]]

[[Bank Connections]] and [[PayPal]] → production requirements flow into → [[Deployment]] and [[Security]]

## AI and deterministic-finance cluster

[[AI System]] → constrained by → [[Security Decisions]]

[[AI System]] → bounded by deterministic finance rules in → [[COBOL Domain Core]]

[[AI System]] → hosted-runtime evidence recorded in → [[Provider Status]]

[[Architecture Decisions]] explains why deterministic financial state and probabilistic AI remain separated.

## Sync, persistence, and client cluster

[[Sync and Offline]] → built on → [[Data and Persistence]]

[[Frontend]] → implements user-facing sync/conflict behavior from → [[Sync and Offline]]

[[Data and Persistence]] → security constraints documented in → [[Security Decisions]]

[[Known Issues and Limitations]] should link back whenever a persistence, concurrency, migration, or offline weakness affects this cluster.

## Mobile and deployment cluster

[[Mobile PWA Android]] → reuses → [[Frontend]], [[Authentication]], and [[Sync and Offline]]

[[Mobile PWA Android]] → release/runtime dependencies tracked by → [[Deployment]] and [[Known Issues and Limitations]]

[[Security]] → constrains → [[Mobile PWA Android]] where browser origin, HTTPS, signing, or platform behavior matters.

## Micro-level subgraphs (added 2026-08-11)

Ten index/hub notes decompose the architecture-level spine above into atomic, individually-linkable concepts — each still ties back to its parent subsystem note, so this is depth added under the existing spine, not a competing structure:

- [[Pages Index]] → every navigable screen, each linked to its owning component, feature, and flow.
- [[Flows Index]] → multi-step sequences (login, vault setup, bank connection...), each linking every participating page/API/storage/provider/security node.
- [[AI Index]] → decomposes [[AI System]] into 8 individual model nodes plus consent/privacy/routing/verification concepts.
- [[Technology Index]] → languages, frameworks, and infrastructure as first-class nodes, each answering where/why it's used.
- [[COBOL Index]] → decomposes [[COBOL Domain Core]] into per-responsibility nodes (normalization, reconciliation, boundary, failure behavior, sandbox limitation).
- [[Data Index]] → all 9 confirmed database tables plus concurrency/encryption/migration mechanisms.
- [[Providers Index]] → per-provider verification-status nodes, conservative wording matching [[Provider Status]] exactly.
- [[Security Index]] → atomic security controls, distinct from [[Security Decisions]] (which stays the decision-record-with-rationale hub).
- [[Testing and CI Index]] → test domains and CI jobs, connecting feature ↔ implementation ↔ test ↔ CI ↔ production-verification state.
- [[Implementation Index]] → file- and micro-logic-level nodes with real architectural significance.

## Engineering feedback loop

[[Commands and Tests]] → produces evidence for → [[Known Issues and Limitations]] and implementation claims throughout the graph

[[Debugging Learnings]] → feeds future changes in → [[Frontend]], [[Backend]], and relevant feature notes

[[Known Issues and Limitations]] → can motivate → [[Architecture Decisions]] or [[Rejected Approaches]]

[[Rejected Approaches]] → preserves context for → [[Architecture Decisions]] and future feature work

This loop is important: test/debugging knowledge should not live as an isolated engineering island; it should connect back to the feature or architecture concepts it affects.

## Graph design rules

When adding durable memory:

1. Identify the concept's **parents/context**: what existing concepts does it depend on?
2. Identify its **effects**: what other concepts does it constrain, enable, or change?
3. Identify its **evidence**: what test, runtime status, provider state, or production condition verifies it?
4. Link the new or changed note to those concepts using meaningful `[[wikilinks]]`.
5. Where useful, update an existing related note so the relationship is discoverable from both directions.
6. Prefer cross-folder/domain links when the relationship is real; folders are organization, not conceptual boundaries.

A healthy durable note normally has several meaningful connections to peer concepts. An isolated note should be unusual and justified.

## What a good graph is not

- not every note linked to every other note
- not artificial links added only to make Graph View denser
- not a pure hub-and-spoke graph where every note only links to [[00 Project Index]] or this note
- not duplicate notes representing the same concept under different names
- not session notes becoming permanent dead-end islands

The goal is **semantic connectivity**: dense enough that a future Claude session can traverse from a feature to its architecture, decisions, risks, evidence, provider state, and production implications without returning to the root index each time.

## Graph architecture & maintenance contract (added 2026-08-12)

This section is the durable topology contract — read it before adding notes at scale so the graph stays legible, not just correct. It reflects a full graph-metrics analysis performed 2026-08-12 (243 notes, 1,553 unique edges, 1 connected component, 0 orphans, 0 broken links — see the `/graph-topology` phase report for the complete before/after numbers).

### Hierarchy

- **Level 0 — root:** [[00 Project Index]] (directory-style entry point) and this note (relationship-centric map). Exactly two root nodes; do not add a third.
- **Level 1 — domain hubs:** the pre-existing feature/architecture notes ([[Authentication]], [[AI System]], [[Bank Connections]], [[PayPal]], [[Frontend]], [[Backend]], [[Data and Persistence]], [[COBOL Domain Core]], [[Security Decisions]], [[Provider Status]], [[Mobile PWA Android]], [[Sync and Offline]], [[Deployment]], [[Security]]) plus the three new top-level system notes ([[Persistence System]], [[Security System]], [[Session System]], [[COBOL Banking Domain]]).
- **Level 2 — subsystem index/hub notes:** the 10 "00 … Index" notes ([[Pages Index]], [[Flows Index]], [[AI Index]], [[Technology Index]], [[COBOL Index]], [[Data Index]], [[Providers Index]], [[Security Index]], [[Testing and CI Index]], [[Implementation Index]]). Each organizes one folder and links every note in it — this makes each Index note a legitimate high-degree hub (verified: 27–93 total degree). That is by design, not an anti-pattern, **as long as atomic notes underneath don't also link straight to Level 0.**
- **Level 3 — atomic notes:** one page/flow/model/table/control/file/test per real concept. An atomic note should link to its nearest Level 1/2 hub, not to [[00 Project Index]] or this note directly. **Verified 2026-08-12:** zero atomic (Level 3) notes link to either root — only the 10 Index notes and the pre-existing domain hubs do. Keep it that way when adding new atomic notes.

### Domain groups (also the Graph View color groups — see Visualization below)

AUTH ([[Authentication]] + auth pages/flows/security controls), AI ([[AI Index]]), FINANCE (finance pages: Dashboard/Transactions/Accounts/Goals/Recurring), DATA ([[Data Index]]), COBOL ([[COBOL Index]]), SECURITY ([[Security Index]]), PROVIDERS ([[Providers Index]] + [[Bank Connections]]/[[PayPal]]), FRONTEND ([[Frontend]] + [[Pages Index]]), BACKEND ([[Backend]] + [[Implementation Index]]), TESTING/CI ([[Testing and CI Index]]), PRODUCTION/INFRASTRUCTURE ([[Production/Deployment|Deployment]] + [[Technology Index]] infra nodes).

### Metadata convention

Every atomic note carries `type`, `domain`, `status` frontmatter (established in the prior graph-expansion pass; do not add a separate `layer` field — it would duplicate what `domain` + folder path already express, and section 9 of the topology-pass instructions explicitly warns against meaningless metadata). Folder path *is* the layer: `Pages/` = UX, `Flows/` = cross-cutting sequence, `Implementation/` = backend/frontend code, `Data/` = persistence, `Security/` = cross-cutting control, `Technology/` = infrastructure/language, `COBOL/` = deterministic domain, `AI/` = probabilistic domain, `Providers/` = external dependency, `Testing/` = verification.

### Relationship convention (the chain, not the star)

Prefer a layered chain over a direct link to a hub:

`Page → Flow → Feature/domain hub → Implementation file → Data/Provider/AI/COBOL node → Security control → Test → CI job → Verification status`

Concrete, verified examples already in the graph: [[Passkey Enrolment Banner]] → [[Passkey Enrolment Flow]] → [[WebAuthn Passkeys]] → [[AuthGate.tsx]] → `server/test/passkey-authenticator-compatibility.test.js` → [[Production Browser Acceptance]] → provider/device-verified: **no**. [[Finance Assistant Page]] → [[Hosted-On-Device Routing Decision]] → [[AI Consent Gate]] → [[AI Financial Snapshot]] → [[AI Data Minimization]] → [[Hosted Hugging Face Inference]] → [[Inference Verification Status]]. [[Transactions Page]] → [[Transaction Normalization]] → [[Banking Core Module]] → [[COBOL Tests]] → [[COBOL CI Compilation]].

### Atomic-node rule

One node per concept that could reasonably appear independently in a graph search, bug report, or code review. Do not split prose into single-sentence notes; do not merge genuinely distinct concepts to save a note.

### Hub rule

A hub (Index or domain note) may have high degree — that is its job. An atomic note should not. If an atomic note starts accumulating 8+ outgoing links, check whether some of them restate a relationship already reachable through a hub it already links to, before adding more.

### Implementation-edge rule

A feature/page/flow concept claiming to be "implemented" should be reachable, within 1–2 hops, from an actual file/module note in [[Implementation Index]] — never assert implementation from a name alone; read the source first.

### Verification-edge rule

A provider/AI/security node's verification status ("implemented" / "local runtime verified" / "provider or device verified" / "production verified") must cite the actual test/CI evidence it's linked to, matching [[Provider Status]]'s conservative wording exactly. Never collapse these four states into one "working" claim.

### Visualization (Graph View)

`FinancePlanner/.obsidian/` is gitignored and machine-local (see `CLAUDE.md`) — its `graph.json` cannot be version-controlled, so the recommended settings are documented here instead, reproducible by any future session. **This section is the durable, repository-tracked record of the settled configuration** — `graph.json` itself will never carry this information across machines or survive a fresh clone.

- **Color groups**, one `path:<Folder>/` query per domain folder (AI, COBOL, Data, Security, Providers, Testing, Technology, Pages, Flows, Implementation, Architecture, Features, Production, Decisions, Engineering) — 15 groups, one color each, unchanged since first configured. Root-level notes (the two Level-0 roots plus the four new system notes) are intentionally left uncolored/default so they read as the neutral core the colored clusters orbit.

#### Final native-Graph baseline (settled 2026-08-12, after 4 rounds of screenshot-verified tuning)

```
centerStrength:      0.25
repelStrength:       20
linkStrength:        1
linkDistance:        380
nodeSizeMultiplier:  0.7
lineSizeMultiplier:  0.4
textFadeMultiplier:  0
showArrow:           false
```

These values were reached iteratively, with each change verified against a live screenshot before the next was made — including one confirmed regression (raising `repelStrength` while lowering `linkStrength` actively undid a cluster's spatial separation, because Obsidian's repulsion force applies uniformly to every node pair regardless of domain, while lowering link strength weakens exactly the intra-domain links that were holding that cluster together) that was caught and reverted rather than compounded. Full round-by-round log: `2026-08-12_20-38_Finance-Planner_PR131_Obsidian-Graph-Visual-Verification-Report.pdf`.

**What these values do and don't achieve:** they optimize *readability* — edge lines recede to background context (`lineSizeMultiplier`), node sizes stay proportionate without any one hub visually dominating (`nodeSizeMultiplier`), and same-color domains get enough repulsion/distance to occupy distinguishable regions where the underlying link structure allows it (`centerStrength`/`repelStrength`/`linkDistance`). They do **not**, and cannot, achieve *architectural hierarchy* — a visual Level-0-root → Level-1-domain → Level-2-hub → Level-3-leaf structure, or golden-angle/radial placement of domain hubs around a center. That was experimentally verified, not assumed: across the tuning rounds, only 2 of the ~14 domains ever achieved genuine spatial separation, and no combination of native force/size/line settings moved that further, because Obsidian's core Graph View has no concept of hierarchy, domain, or edge type anywhere in its physics — `colorGroups` is a cosmetic overlay applied after layout, invisible to the forces that actually position nodes, and there is no supported mechanism for deterministic or pinned node coordinates.

**Conclusion: further native physics tuning is not recommended.** The values above are the settled baseline for as long as this vault uses native Graph View. The planned next architectural step — deterministic radial/hierarchical layout, golden-angle domain placement, typed edge styling, importance-based node sizing — requires a dedicated **Finance Planner Architecture Graph** custom view/plugin (design proposed in the visual-verification report above; **not implemented as of this note**).

- **Filters:** tags and attachments hidden (`showTags`/`showAttachments`: false) — this vault uses folder + frontmatter for structure, not Obsidian tags, so tag nodes would add visual noise without carrying real graph information.

### Extending the graph without creating a hairball

1. New atomic note → link it to its nearest Level 2 index/hub and to 2–5 genuinely related peers (chain-topology above), not to every hub that happens to be adjacent.
2. New domain-spanning concept → consider whether it deserves its own Level 1 hub (rare) or belongs as an atomic note under an existing Index (usual case).
3. Before creating a note, search for an existing one with overlapping meaning — extend it instead of duplicating.
4. After a significant addition, spot-check: does this note's own domain folder + the `path:` color-group system already make it visually identifiable? If a note's content clearly belongs to two domains, that's fine — cross-domain edges are expected and valuable; just don't make it a third color by giving it dual folder placement.

Related: [[Memory System]] · [[00 Project Index]] · [[System Architecture]] · [[Architecture Decisions]] · [[Security Decisions]] · [[Provider Status]] · [[Known Issues and Limitations]]
