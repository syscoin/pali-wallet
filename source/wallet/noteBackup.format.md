# Pali private-note backup codec v1

This codec is dormant shared functionality. It does not enumerate wallet profiles, authenticate a wallet password, read/write the note vault, import notes, reconcile chain state, start jobs, or save files. Its decrypted return value contains bearer secrets and must stay inside the trusted wallet authority. A file password does not authorize destination-wallet changes.

## File encoding

A file is one 64-byte header followed by exactly the declared ciphertext length. All integer fields use unsigned big-endian encoding. No compression, archive, trailing bytes or extensions are accepted.

| Byte offsets | Field               | Required value                          |
| ------------ | ------------------- | --------------------------------------- |
| 0–7          | Magic               | ASCII `PALINOTE`                        |
| 8            | Format version      | 1                                       |
| 9            | Cryptographic suite | 1                                       |
| 10           | Payload encoding    | 1                                       |
| 11           | Flags               | 0                                       |
| 12–43        | Salt                | 32 fresh CSPRNG bytes                   |
| 44–55        | AES-GCM nonce       | 12 fresh CSPRNG bytes                   |
| 56–59        | Ciphertext length   | Includes the 16-byte authentication tag |
| 60–63        | Reserved            | All zero                                |

Suite 1 is PBKDF2-HMAC-SHA512 with exactly **900,000 iterations**, producing a non-extractable 256-bit AES-GCM key. The complete header is authenticated as associated data. The AES-GCM tag is 128 bits and follows the ciphertext, as returned by WebCrypto. Header bytes cannot select another work factor or algorithm.

Passwords use exact UTF-8 bytes without trimming, case conversion or Unicode normalization. Unpaired UTF-16 surrogates are rejected. Encryption requires at least 12 Unicode code points; both directions require 1–1,024 UTF-8 bytes. Decryption deliberately permits shorter passwords to avoid imposing encryption-side strength policy on a recovery attempt. There is no password fallback or standalone verifier.

The maximum plaintext is 8 MiB, the maximum file is 8 MiB + 80 bytes, and the maximum inventory is 512 distinct notes. File framing is admitted before KDF work. Strict UTF-8 decoding, depth 8, 12,000 value-node and bounded string-token checks run before JSON.parse. The parsed payload also passes the shared JSON work-budget check and complete schema validation.

## Canonical plaintext

Encoding 1 is exactly the compact JSON produced by the codec's allowlisted projection. Property order is fixed:

- Payload: `format`, `version`, `createdAt`, `notes`.
- Entry: `note`, `createdAt`, optional `history`.
- History: optional `deposit`, optional `withdrawal`; at least one exists.
- Deposit: `outcome`, `from`, `nonce`, optional `transactionHash`.
- Withdrawal: `outcome`, `mode`, optional `from`, optional `nonce`, optional `transactionHash`, optional `jobId`.

The payload format is `pali-private-notes`, version 1. Timestamps are integers from zero through the maximum JavaScript Date value, 8,640,000,000,000,000 milliseconds. Notes use the canonical lowercase Tornado Classic ETH note representation accepted by the shared parser for the four pinned Ethereum-mainnet pools. Identity is recomputed from the note; duplicate pool/commitment identities are rejected. Note text is not evidence of funding or spendability.

Addresses and transaction hashes use lowercase `0x` hex. Nonces are canonical decimal uint64 strings. Deposit history always includes `from` and `nonce`; submitted deposits also include a transaction hash. Direct withdrawal history includes `from` and `nonce` and cannot include a job ID. Relayed withdrawal history excludes `from`/`nonce`; a job ID, if present, is 1–128 ASCII letters, digits, `_` or `-`. Submitted withdrawals require a transaction hash or relayed job ID. `unknown` and `submitted` are historical observations, never execution instructions or confirmation claims.

Unknown fields, null optional fields, arbitrary URLs, RPC credentials, proofs, signatures, raw transactions, active-job objects, local record IDs, private-record profile IDs, and spendability flags are not accepted. After validation, decryption requires re-encoding to equal the original plaintext exactly. This rejects duplicate keys, alternate key order, whitespace, noncanonical numbers and alternate escape encodings.

## Authority and portability boundary

`createNoteBackupCodec` requires explicit WebCrypto and a current-operation guard. Inputs are copied/projected before asynchronous work. The guard is checked across cryptographic awaits; revoked results are discarded. Temporary password/plaintext byte buffers are cleared in `finally`; JavaScript strings and platform CryptoKeys do not have a provable zeroization guarantee.

Fresh wallet authentication, complete current-wallet inventory, file handling, verified-save receipts, atomic merge and durable reconciliation remain separate integrations. The existing wallet password, seed or OS keystore is not a file-decryption input. An unknown retained root must not be assumed to belong to the active wallet. No file can automatically reactivate a withdrawal or relayer job.

The fixed vectors contain synthetic notes/passwords only and were assembled independently using Node's classical PBKDF2/AES-GCM API. They verify wire agreement with this WebCrypto implementation. Browser or Node success does not qualify a native crypto provider, native file handling or device performance.

Regenerate the independent fixture with `node source/wallet/noteBackup.vectors.cjs`. Its implementation uses no production codec helpers, and its inputs contain no real user data.

Caller payload objects must use plain own enumerable data properties and dense plain arrays. Accessors, hidden or symbolic properties, custom array methods, subclasses and sparse slots are rejected before any key derivation. File bytes are copied through intrinsic typed-array slots so overridden getters cannot bypass the size limit or expose their exceptions.
