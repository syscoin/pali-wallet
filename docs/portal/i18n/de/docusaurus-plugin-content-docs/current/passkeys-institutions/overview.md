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

## Unterstützte Netzwerke

Pali Smart Accounts funktionieren auf kompatiblen EVM-Chains, auf denen die Pali Factory und Module an den von Pali erwarteten Adressen existieren. Das ist nicht auf von Pali betriebene Chains beschränkt: Wenn die aktive Chain den kanonischen CREATE2-Deployer bereitstellt, kann Pali die fehlende Smart-Account-Einrichtung direkt in der Wallet deployen. Öffnen Sie Pali Settings, gehen Sie zu Advanced und nutzen Sie bei **Smart account setup** den Deploy-Button.

Passkey-Validatoren benötigen P-256 WebAuthn-Verifikation. Viele moderne EVM-Umgebungen stellen dies über ein P-256/passkey precompile bereit; prüft die Chain-Unterstützung trotzdem vor dem produktiven Einsatz.
