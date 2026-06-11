---
title: Testing with Pali
---

Use the Syscoin test dapp for manual integration testing and your own automated tests for application logic.

## Hosted test dapp

The Syscoin test dapp is hosted at:

```text
https://syscoin-test-dapp.vercel.app/
```

It includes Pali smart-account flows, `wallet_prepareSmartAccount`, `wallet_sendCalls`, ERC-20 allowance batch generation, and common wallet requests.

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

## Smart-account testing checklist

1. Connect Pali through the default provider selector.
2. Create a smart account with `wallet_prepareSmartAccount` and wait for Pali to confirm deployment and validator setup.
3. Fund the smart account or gas payer if required by your test.
4. Build an ERC-20 approve plus `transferFrom` batch.
5. Send the batch with `wallet_sendCalls`.
6. Confirm the wallet shows decoded calldata and one smart-account authorization for the smart-account batch.
