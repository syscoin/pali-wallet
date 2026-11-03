---
title: Bitcoin-style dapps
---

Pali's UTXO provider makes browser dapps possible for Bitcoin-style account flows, including Syscoin UTXO and compatible transaction models.

## What changes versus EVM

EVM dapps usually ask one account to sign a transaction object. UTXO dapps usually:

1. Read account and UTXO state.
2. Build a PSBT.
3. Include a change address.
4. Ask the wallet to sign.
5. Finalize and broadcast.

## Minimum integration shape

Pass a structured Pali PSBT object, not a raw Base64 string. `syscoinjs-lib` exports `{ psbt: <base64>, assets: <JSON string> }`; provide the asset map when applicable. `sys_sign` returns a signed object in the same format, which can remain partially signed. The returned `assets` field is empty; retain any asset metadata you need separately.

```js
import { utils as sys } from 'syscoinjs-lib';

const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

// Supply your constructed syscoinjs PSBT and optional asset map.
const paliPsbt = sys.exportPsbtToJson(psbt, assetsMap);
const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [paliPsbt],
});
```

## Best practices

- Build PSBTs deterministically and show users a transaction summary in your app.
- Use Pali's change address instead of reusing receive addresses.
- Handle testnet/mainnet differences.
- Handle wallet lock, rejection, and network mismatch errors.
- Avoid requesting xpub or signing until the user initiates a meaningful action.
