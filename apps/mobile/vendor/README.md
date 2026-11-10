# Temporary reviewed Keyring candidate

This archive is the local 2.1.10 candidate from [Sysweb3 #106](https://github.com/sidhujag/sysweb3/pull/106), source `8a98ad744b761065f57b6b104c62862f4d07479b`. Later SDK commit `d3482d7c33893633581e18c83bb69448c1738c4c` changes only its compiled-runtime test. Both Pali hosts use the same archive while npm publication awaits interactive approval.

SHA256: `e8ebbe3998e593dca221d1148d62a3b417b7e5abd83ab8419794e76e8ea2601c`. All 322 packaged files were compared byte for byte with fresh CJS/ESM build outputs. There are no Pali node-module patches to this package. Replace the two file dependencies and lock entries with the byte-verified official npm package, then remove this archive and document.
