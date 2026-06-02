---
title: Accounts verbinden
---

Pali-Verbindungs-Requests sind explizite Benutzerfreigaben. dapps sollten Zugriff nur anfordern, wenn der Benutzer auf eine Verbinden-Schaltfläche klickt.

## EVM verbinden

```js
const provider = await getPaliEthereumProvider();

const [address] = await provider.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## UTXO verbinden

```js
const provider = window.pali;

const [address] = await provider.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Verbindungszustand lesen

```js
const isEvmConnected = await window.ethereum.request({
  method: 'wallet_isConnected',
});

const account = await window.ethereum.request({
  method: 'wallet_getAccount',
});
```

## Ein aktiver Account pro dapp

Pali kann viele dapp-Origins verbunden halten. Für eine einzelne Origin verfolgt Pali einen aktiven verbundenen Account. Wenn ein sensibler Request eine andere `from`-Adresse referenziert, kann Pali den Benutzer bitten, die dapp-Verbindung zu wechseln.

## Trennen

Für EVM-Berechtigungen trennt `wallet_revokePermissions` die dapp von Pali.

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```
