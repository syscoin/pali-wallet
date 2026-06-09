---
title: Pali Smart Accounts
---

Pali Smart Accounts sind Contract-Konten, die Pali für Nutzer erstellen, verbinden und bedienen kann. Für normale Nutzer fühlt sich das wie eine Wallet an: Dapp-Anfrage prüfen, mit Passkey oder Wallet-Schlüssel bestätigen, und Pali sendet die Transaktion. Technisch ist das Konto modular: Validatoren autorisieren Aktionen, Executor-Module fügen Funktionen wie Recovery hinzu.

## Einfach erklärt

- Eine Konto-Adresse hält die Assets und ist die Adresse, die Dapps sehen.
- Das Konto kann Passkey, ECDSA oder eine Composite-Policy nutzen.
- Guardian-Recovery kann den aktiven Validator nach einer Wartezeit ersetzen.
- `wallet_sendCalls` kann mehrere Calls als eine atomare Aktion ausführen.

## Technisches Modell

`PaliSmartAccount` führt Calls aus und validiert Signaturen über ERC-7579-style Module. `PaliSmartAccountFactory` leitet deterministische Adressen ab und deployed Konten. Pali nutzt ERC-4337-style Encoding und EIP-1271 für Contract-Signaturen.

## Für Institutionen und Teams

Institutionen sollten Pali Smart Accounts als Kontoinfrastruktur behandeln, nicht nur als Passkey-Login. Nutzt Passkeys für einfaches Onboarding, ECDSA oder Composite-Validatoren für Team- oder Hardware-Wallet-Kontrolle, Guardian-Recovery für verzögerten Ersatz und finanzierte Gas-Payer für Deployment und Ausführung.

Pali warnt ausdrücklich, wenn eine Dapp externe ECDSA-Owner anfordert, weil diese Adressen zukünftige Kontoaktionen autorisieren können.

## Dapp-Methode

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```
