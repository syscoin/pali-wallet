# Isolated standard test-dapp conformance

This journey drives the real Pali extension from the official MetaMask QA dapp:
https://metamask.github.io/test-dapp/. It uses a fresh browser profile and the
public disposable Anvil mnemonic. Never use the fixture mnemonic on a public
network. Neither a personal Chrome profile nor the shared zkTanenbaum QA wallet
is used.

Build the exact source revision first, then pass its absolute extension path:

```bash
yarn build:chrome
PALI_TEST_DAPP_EXTENSION_PATH="$PWD/build/chrome" \
PALI_TEST_DAPP_ANVIL="$(command -v anvil)" \
yarn e2e:harness test-dapp-conformance.journey.spec.ts
```

The `test dapp conformance` job in `main.yml` runs this focused journey on
every PR, alongside the unit and visual checks. It uses only disposable local
accounts and chains, requires no wallet secrets, cancels superseded runs for
the same PR, and uploads the report, screenshots, videos and failure traces.
The broader wallet journeys remain in the existing nightly/manual
`e2e-harness.yml` workflow. Both workflows install Anvil v1.7.1 through a pinned
Foundry action and label reports with the tested checkout's `github.sha`.

The journey owns and stops two Anvil processes, chains 31337 and 31338. Default
loopback ports are 28545 and 28546; set `PALI_TEST_DAPP_PORT_A` and
`PALI_TEST_DAPP_PORT_B` to unused ports when necessary. Occupied ports fail
preflight rather than attaching to or killing another task's RPC. All fixture
RPC helpers reject non-fixture URLs. Browser routing rejects transaction
broadcast RPCs to any URL outside those two loopback endpoints.
Before onboarding, a dummy invalid raw transaction to a reserved `.invalid`
domain proves that routing intercepts the extension's own MV3 worker fetches.
This canary must be blocked before the journey can proceed.

The unchanged production CSP requires HTTPS RPCs. The helper creates a
one-day loopback certificate and an HTTPS proxy at each client port; Anvil
backends listen 100 ports higher. Certificate errors are ignored only by the
disposable QA browser. Direct receipt assertions query those same owned Anvil
backends. No production CSP or immutable baseline files are modified.

To reproduce just the valid-SIWE and invalid-transaction-value regressions:

```bash
PALI_TEST_DAPP_EXTENSION_PATH=/absolute/path/to/immutable/baseline/build/chrome \
PALI_TEST_DAPP_SCOPE=regressions \
yarn e2e:harness test-dapp-conformance.journey.spec.ts
```

Coverage includes discovery, unauthorized account/permission reads, explicit
connection, origin-scoped permissions, signature recovery independent of Pali,
official personal-sign and typed-data V1/V3/V4 fixtures, reversed personal-sign
compatibility, current local-chain SIWE with scheme/resources, SIWE negatives,
numeric malformed-request errors without popups, non-hex and odd-length
personal-sign bytes in both parameter orders without approval windows,
valid unknown-chain errors,
local add/switch-chain events, mined legacy and EIP-1559 transaction receipts
and fee-field evidence, legacy inference from a gas-price-only request,
uppercase quantity-prefix normalization, an explicit
below-estimate dapp-fee choice, local
contract creation with omitted `from`/`to`, rejected transaction nonce stability, and
account-revocation events versus continued RPC connectivity. A rapid malformed
typed-signing/transaction burst must settle with numeric errors without opening
approval or spam windows. Another case rejects two real signing approvals,
repeats malformed requests within ten seconds, and verifies that the next real
attempt shows the three-request warning. Continue must open the ordinary
approval, which the test rejects; screenshots and unchanged local nonce are
recorded. These cases keep the production thresholds and block duration intact.
Unrelated negative approvals are paced outside the wallet's ten-second spam
window so they exercise their own validation. The official
SIWE fixture contains an old issue date and chain ID 1; its ordinary EOA signature
is checked as message signing rather than claiming a complete relying-party
authentication session.
V1 recovery uses the already locked `@metamask/eth-sig-util` verifier; V3/V4
and personal/SIWE recovery use Ethers independently of Pali's provider result.

The actual ERC20 Create Token (four decimals), ERC721 Deploy and ERC1155 Deploy
buttons also run against the owned local chain. Their 12–15 kB initcode and
constructor arguments are pinned from the official test-dapp constants at
`c92f83b119f2fa49c69759dafc40c637bd55b137` in
`tests/fixtures/officialDeploymentContracts.json`. Approval must retain the
exact original bytes in Hex, identify Contract Deployment, display finite fees
and usable controls, and mine
from the permitted account with the expected nonce and creation address.
Independent local reads check runtime code, ERC20 supply/decimals/balance,
ERC721 identity/interface support and ERC1155 ownership/URI/interface support.
Cancelling a long deployment must return `4001` without consuming a nonce.
Each case records the original dapp requests, matching raw gas-estimate RPC
replies, approval text and popup errors. These are local deployment tests;
they do not establish behavior on a public RPC or hardware wallet.
A separate fault case leaves the dapp's first finite gas estimate unchanged
and deliberately corrupts only the wallet's second local RPC estimate. It must
show the existing fee error, settle the request with a numeric error, close
without a rendering exception and consume no nonce. This injected invalid RPC
reply is not classified as an ordinary deployment failure. Its temporary route
falls back to the unchanged broadcast guard for every unrelated request.

To run only these deployment cases, set `PALI_TEST_DAPP_SCOPE=deployments`;
`deployments-erc20` runs just the ERC20 reproduction.
`deployments-fault` runs only the injected wallet-quote case.

The journey also checks NFT-order advisories on the disposable local chain:
a paid 0x order receives no guessed scam warning, a zero-payment sale with a
third-party fee receives its factual advisory, and a Seaport 1.4 order without
assets payable to the order creator receives its factual advisory. Signatures
remain user-approved and
are independently recovered against the original unchanged typed data.
These checks validate order-term explanations, not threat intelligence,
contract deployment, token ownership or whether the order can be filled.

Intentional policy differences are recorded: unsafe raw `eth_sign` is disabled
(`4200` or registry-level `-32601`), and WebSocket subscription methods reject
with `4200`. EIP-1559 transactions requesting a zero maximum or zero priority
fee currently reject with `4200` before approval: the pinned keyring SDK cannot
preserve those choices and silently converts them to legacy fees. The journey
records this SDK limitation honestly rather than treating it as supported.
MetaMask install/SDK/Snaps features and smart-account delegation are
outside this standard EOA baseline.

Each run writes `test-dapp-conformance.json`, screenshots, local Anvil logs,
videos, and Playwright failure traces under `e2e/artifacts/<runId>/`. The report
records the exact extension path, manifest version, SHA-256 bundle fingerprints,
and a SHA-256 fingerprint of every built file (including lazy UI chunks). The
artifact fingerprint hashes sorted relative paths followed by a NUL, each
file's SHA-256 hex digest, and a newline. Set `PALI_TEST_DAPP_REVISION` to label
the source commit when testing a copied immutable build. It also records
requests, signatures, timings, errors, event
payloads, and receipt. A baseline failure is evidence only after setup completes;
browser launch, fixture availability, and locator failures are separate setup
errors.
