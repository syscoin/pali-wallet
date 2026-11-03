# Staged keyring package

This temporary, hash-pinned package lets Pali CI exercise the reviewed sysweb3 implementation before npm publication. It contains compiled public code, not wallet data. `provenance.json` identifies the source commit and every packaged file; the install verifier checks both archive and installed bytes.

The source changes are reviewed in [sysweb3 #42](https://github.com/sidhujag/sysweb3/pull/42) and [#43](https://github.com/sidhujag/sysweb3/pull/43). Once the complete SDK changes are ready and npm publication is approved, replace the lockfile's local archive source with the published registry URL only after verifying identical integrity, then remove this staging directory and its install verifier.
