---
title: Berechtigungen
---

Pali unterstützt Berechtigungen im EIP-2255-Stil für EVM-dapps.

## Berechtigungen anfordern

```js
const permissions = await window.ethereum.request({
  method: 'wallet_requestPermissions',
  params: [{ eth_accounts: {} }],
});
```

Die meisten dapps können stattdessen `eth_requestAccounts` verwenden. Verwenden Sie `wallet_requestPermissions`, wenn Sie explizite Berechtigungsobjekte und erlaubte Chain-Metadaten möchten.

## Berechtigungen abrufen

```js
const permissions = await window.ethereum.request({
  method: 'wallet_getPermissions',
});
```

## Berechtigungen widerrufen

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

In Pali trennt der Widerruf die dapp von der Wallet. Behandeln Sie dies als vollständige Site-Trennung statt als granulare teilweise Berechtigungsbearbeitung.

## Account-Wechsel

Für blockierende Methoden wie Transaktionsversand und Signatur prüft Pali, dass der verbundene dapp-Account zum von der dapp angeforderten Account passt. Wenn die dapp eine `from`-Adresse sendet, die nicht der aktive verbundene Account ist, kann Pali den Benutzer auffordern, die dapp-Verbindung zu wechseln.
