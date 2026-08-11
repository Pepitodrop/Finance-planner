---
type: technology
domain: cobol
status: implemented
---

# GnuCOBOL Runtime (libcob)

Distinct from the `cobc` compiler: the compiled binary needs `libcob.so.4` (the GnuCOBOL runtime shared library) present at execution time, not just build time.

- **`cobc` (compiler):** build-time only, not needed at runtime
- **`libcob` (runtime library):** hard runtime dependency for the compiled binary to even load
- **Precisely diagnosed 2026-08-11 (`/ship`):** a local sandbox run showed the binary present (`build/transaction-rules` exists) but failing with `error while loading shared libraries: libcob.so.4: cannot open shared object file` — a missing-runtime-library failure, distinct from a missing-binary (`ENOENT`) failure previously recorded in this vault. Corrected in [[Known Issues and Limitations]].

Related: [[COBOL Index]] · [[GnuCOBOL (language)]] · [[COBOL Sandbox Limitation]]
