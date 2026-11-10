# Temporary shared SDK review candidate

This is the reviewed source candidate for operation-scoped secret lifetime. Mobile explicitly selects this policy; the extension retains session-scoped unlock. The package uses the existing derivation, encrypted vault and signing implementations.

`REVIEWED-CANDIDATE.json` records source and tarball digests. This package is not published. Replace the mobile dependency with the reviewed official npm release and remove this directory after publication and byte verification.
