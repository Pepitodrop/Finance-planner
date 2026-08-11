---
type: issue
domain: cobol
status: implemented
---

# COBOL Sandbox Limitation

Any dev sandbox without `apt-get`/root access to install the GnuCOBOL runtime (`libcob.so.4`) will see 4 local test failures in [[COBOL Tests]]. This is CI-clean (CI installs the full toolchain — [[COBOL CI Compilation]]) and does not affect production, which ships the compiled binary inside its own container image with the runtime present.

- Root-caused precisely during PR #131's `/ship` phase — corrected the prior vault description from `ENOENT` (missing binary) to the actual `libcob.so.4` (missing runtime library) failure mode.

Related: [[COBOL Index]] · [[Known Issues and Limitations]] · [[Rejected Approaches]]
