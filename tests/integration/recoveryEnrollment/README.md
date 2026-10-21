# Recovery enrollment signing integration

This isolated test joins the actual Pali `SignEth` React component, personal-sign
hashing, smart-account authenticator dispatch and installed keyring SDK signing
to the real Sysnode enrollment HTTP route and deployed Pali ERC-1271 contracts.
It does not hand-build the signature that is submitted to the backend.

The renderer's state/controller transport is a fixture. This is **not** a full
extension-browser journey, proof of live-chain monitoring, or hardware-wallet
qualification. Only disposable loopback Anvil contracts and a public test key
are used. The backend uses an in-memory database and mail transport; no public
funds or external email service are needed.

## Run

Use Node 23.11.1, Anvil 1.7.1, and install Pali's locked dependencies. Separately
check out `syscoin/sysnode-backend` at
`47aab836f81e74a2ddb019b523b026da2882c07c` and run `npm ci` there with the same Node
version. Then run from Pali:

```sh
RECOVERY_BACKEND_ROOT=/absolute/path/to/sysnode-backend yarn test:recovery-enrollment
```

`ANVIL_BIN` can specify the executable. `RECOVERY_ENROLLMENT_EVIDENCE_DIR` can
specify a directory for machine-readable Jest results and contract evidence.
The runner checks the backend revision and rejects tracked modifications. It
also checks the Anvil version; the fixture verifies the immutable deployment
source hash and actual recovery-module runtime hash before serving requests.

The ordinary Jest configuration excludes this directory so normal unit tests
do not require Anvil or a second repository. Its separate configuration avoids
the asset suite's global cryptographic mocks. Only the unused UTXO/hardware
adapters and renderer/controller transport are substituted; all relevant EVM
cryptographic code runs unchanged.

Coverage includes successful enrollment with unchanged component-returned
bytes, wrong account, wrong chain, altered message and one-time challenge
replay rejection. Creating a stored subscription must not itself send email.
