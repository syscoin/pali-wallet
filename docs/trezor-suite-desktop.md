# Trezor Suite Desktop bridge

Pali 4.0.78 prepares the extension policy for the Trezor Connect Suite Desktop
route used by Trezor Safe 7. It permits the local websocket at
`ws://127.0.0.1:21335/connect-ws`. Other plaintext websocket hosts, ports and
paths remain blocked by the extension's content security policy. The script
policy and extension permissions are unchanged.

## Runtime release dependency

This companion change prepares Pali's CSP. Complete Safe 7 support also needs
the pending `@sidhujag/sysweb3-keyring` 1.0.615 hardware update, stacked on
[the SDK signing changes in PR #17](https://github.com/sidhujag/sysweb3/pull/17).
That update enables the installed Trezor Connect SDK's Suite transport route:
[hardware SDK PR #18](https://github.com/sidhujag/sysweb3/pull/18). Pali's SDK
dependency and existing package patch must be updated together only after
that version has an installable, validated published tarball.

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

`yarn test --runInBand --coverage=false tests/unit/manifestCsp.test.ts` checks
that the source and generated manifest agree, that only the exact Suite
plaintext websocket is added, and that the other CSP directives are retained.
A disposable headless Chromium extension can verify the exact endpoint opens
against a mock websocket bridge while other paths, ports and hostnames emit
`connect-src` violations. This policy check does not establish physical-device
signing or end-to-end Safe 7 support; those remain SDK release checks.
