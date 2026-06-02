---
title: Testing with Pali
---

Use the Syscoin test dapp for manual integration testing and your own automated tests for application logic.

## Hosted test dapp

The Syscoin test dapp is hosted at:

```text
https://syscoin-test-dapp.vercel.app/
```

It includes Pali passkey flows, `wallet_createPasskeyAccount`, `wallet_sendCalls`, ERC-20 allowance batch generation, and common wallet requests.

## Local test dapp

If you need to test unpublished changes:

```bash
git clone https://github.com/syscoin/test-dapp.git
cd test-dapp
yarn install
yarn start
```

## Local Pali extension

```bash
git clone https://github.com/syscoin/pali_wallet.git
cd pali_wallet
yarn install
yarn dev:chrome
```

Then load `build/chrome` through the browser extension developer page.

## Passkey testing checklist

1. Connect Pali through the default provider selector.
2. Create or recover a passkey account with sponsorship disabled.
3. Fund or deploy the passkey account if required by your test.
4. Build an ERC-20 approve plus `transferFrom` batch.
5. Send the batch with `wallet_sendCalls`.
6. Confirm the wallet shows decoded calldata and a single WebAuthn approval for the passkey batch.
