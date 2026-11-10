# Local passkey unlock review

Source: `14320f73ba48e94574e471bd6a6521eb24a74a91`.

These are actual production-extension renders from the offline local-passkey journey. The disposable public test wallet uses a Chromium virtual CTAP2.1 authenticator with PRF; it is not a physical authenticator or device qualification. The journey passed enrollment, same-wallet unlock, removal, and password fallback. No transaction was submitted. The final pass includes the reviewed StrictMode controller-lifetime fix and the current mobile base.

## Settings at 320 pixels

![Passkey settings](settings-320.png)

## Unlock

![Password and passkey choices](unlock.png)

The existing session-based extension unlock model is unchanged. Enrollment requires the current password; passkey assertions require user verification and a matching PRF-wrapped local key. Unsupported browsers/providers keep password unlock.
