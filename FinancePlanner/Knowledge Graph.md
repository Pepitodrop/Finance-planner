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

Related: [[Memory System]] · [[00 Project Index]] · [[System Architecture]] · [[Architecture Decisions]] · [[Security Decisions]] · [[Provider Status]] · [[Known Issues and Limitations]]
