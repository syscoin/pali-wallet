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

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Best practices

- Build PSBTs deterministically and show users a transaction summary in your app.
- Use Pali's change address instead of reusing receive addresses.
- Handle testnet/mainnet differences.
- Handle wallet lock, rejection, and network mismatch errors.
- Avoid requesting xpub or signing until the user initiates a meaningful action.
