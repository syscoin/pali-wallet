# Packaged Classic prover

This is a local-only Groth16 worker for the pinned Tornado Classic ETH circuit.
It does not read wallet storage, select recipients, submit transactions, or call
an Ethereum RPC. The background passes an already-reviewed witness input using
an offscreen-initiated private runtime Port. The host announces authenticated
READY only after registering its listeners; one public readiness query handles
already-running documents. A cold missing receiver waits for that event with
a bounded deadline, never a sleep or retry loop. Only a public connect/cancel command
uses runtime message broadcasting.

`worker.ts` runs the precompiled witness, converts exactly 28,300 field elements,
then delegates the legacy prover's arithmetic to two static subworkers. The
offscreen host retains all three Worker handles and terminates all of them on
success, error, timeout, cancellation, or Port disconnection. No Blob worker,
string evaluation, dynamically downloaded code, or remotely supplied circuit
wiring is used. BigInt/string memory cannot be guaranteed erased; byte buffers
are cleared and dedicated workers are terminated after each job.

The independent Noble BN254 verifier checks the output against the packaged
canonical verification key. The six public signals are also compared with the
background's expected root, nullifier hash, recipient, relayer, fee and refund.

## Build inputs and reproduction

Run `node scripts/generate-privacy-prover.cjs`. It fetches SHA-256-pinned files
from immutable upstream commits into an OS temporary folder, then regenerates
the files in this directory. Alternatively use `--source-root DIR`, where DIR
contains `artifacts/tornado.json`, `artifacts/withdraw_verification_key.json`,
and the pinned `vendor/snarkjs` and `vendor/websnark` source checkouts. Every input
hash and generated public-asset hash is recorded in `assets/manifest.json`.

The witness's JavaScript functions are emitted as ordinary static source at
build time. Required signal/component wiring is packaged as `metadata.json.gz`;
it is loaded from the extension itself and decoded with DecompressionStream.
Unused debug names, component-name index and constraint duplication are omitted.
The original reference's full constraints remain part of qualification evidence,
not a runtime download. GPL notices and original headers are retained; see
`LICENSES.md` and `COPYING`. These notices do not resolve distribution-license
compatibility for the surrounding application.

The only remote artifact is the 14,522,256-byte public proving key. Its fixed
URL, exact length and SHA-256 are in `utils/privacy/proverArtifacts.ts`. Every
cached key is hashed again before use; cache writes contain only public bytes.
No downloaded JSON, JS, WASM or circuit wiring is executed.

## Integration

- Import `scripts/privacyProver/offscreen` from the existing offscreen entry.
- Copy `assets/metadata.json.gz` and `assets/groth16.wasm` to
  `assets/privacy-prover/` in the package. The verification key is bundled by its
  static import; it is not fetched remotely.
- Include `COPYING` and `LICENSES.md` in the distributed notices.
- Call `runPrivacyProof` only in a lazy background controller, after saving any
  new note and authenticating the current wallet session. Never expose the input
  type or raw note in the message-facing UI API.
- On every lock/reset/session replacement, send the existing cleanup path's
  trusted `PALI_PRIVACY_PROVER_CANCEL_WORKER` command or call `cancelPrivacyProof`.
- Pass a pinned session/account/network guard to `assertCurrent`; it is checked
  before private input dispatch and before accepting worker messages/results.

## Qualification

The public deterministic synthetic fixture is `utils/privacy/prover.fixture.json`.
The proof came from the canonical proving key and verifies against the canonical
verification key; all six public-input changes reject. A bad Merkle path fails
witness creation. This fixture is not a funded note.

For a full offline production-runtime check, provide the public proving key:

```
node --disallow-code-generation-from-strings \
  source/scripts/privacyProver/testing/fullProof.cjs /path/to/tornadoProvingKey.bin
```

The harness uses actual packaged witness code, numeric metadata, WASM and static
worker entrypoints; it performs no network requests. A qualification run produced
and verified the full proof in about 9.7 seconds, with process maximum RSS about
222 MiB. This is Node evidence, not a browser resource-limit qualification.
