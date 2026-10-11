# Trezor Suite Desktop bridge

Pali 4.0.78 uses the published `@sidhujag/sysweb3-keyring` 1.0.615 and enables
the Trezor Connect Suite Desktop route used by Trezor Safe 7. It permits the
local websocket at
`ws://127.0.0.1:21335/connect-ws`. Other plaintext websocket hosts, ports and
paths remain blocked by the extension's content security policy. The script
policy and extension permissions are unchanged.

## Runtime release dependency

The dependency and lockfile use the installable, integrity-verified 1.0.615
release. It includes [the replacement signing protections from SDK PR #17](https://github.com/sidhujag/sysweb3/pull/17)
and [the Suite transport update from SDK PR #18](https://github.com/sidhujag/sysweb3/pull/18).
The temporary 1.0.613 package patch is removed together with this upgrade.
All 120 published package files match the reviewed candidate. The release
retains Pali's explicit replacement fee approval and smart-account gas-payer
checks.

## Connecting Safe 7

1. Install and run Trezor Suite Desktop, and connect and unlock the device.
2. Start the hardware wallet connection in Pali and approve the connection
   request in Suite Desktop and on the device when prompted.
3. If Chromium asks for local network access, grant it for this connection so
   Trezor Connect can reach Suite's local bridge.
4. Check the account and transaction details on the device before approval.

Suite Desktop must stay running while Pali uses this route. The CSP permission
does not replace Suite/device approval or the wallet's signing checks.
Earlier Trezor transport paths remain governed by the SDK.

## Validation

The published 1.0.615 tarball passes SHA-1/SHA-512 integrity verification and
matches all 120 files in the reviewed package. A clean install with an empty
Yarn cache and the frozen lockfile passes lint, localization checks, type
checking and all 2,308 unit tests on the repository's pinned Node 23.11.1.
The Chrome production build passes the unchanged budgets: background
4,299,832 / 4,300,000 bytes and total package 8,660,027 / 9,000,000 bytes.

`yarn test --runInBand --coverage=false tests/unit/manifestCsp.test.ts` checks
that the source and generated manifest agree, that only the exact Suite
plaintext websocket is added, and that the other CSP directives are retained.
A disposable headless Chromium extension can verify the exact endpoint opens
against a mock websocket bridge while other paths, ports and hostnames emit
`connect-src` violations. This policy check does not establish physical-device
signing or end-to-end Safe 7 support. Physical-device signing remains
unverified; users still need current Suite Desktop and device approval.
