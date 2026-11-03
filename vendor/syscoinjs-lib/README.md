# Staged transaction library

This temporary archive lets Pali exercise the shared proof-import isolation before npm publication. It contains public library code, not wallet data. `provenance.json` pins the source commit, archive digests and all seven packaged files; the existing postinstall verifier checks both this package and the staged keyring.

The source changes are in [syscoinjs-lib #18](https://github.com/syscoin/syscoinjs-lib/pull/18), with the release version in [#19](https://github.com/syscoin/syscoinjs-lib/pull/19). The proof dependencies remain installed and the proof API remains available; they load when the proof operation is requested instead of during ordinary wallet startup.

After the reviewed artifact is published, replace the lockfile's local archive source with the registry source only after checking identical package integrity. Remove this directory and its verifier entry together.
