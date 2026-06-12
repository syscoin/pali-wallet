---
title: Smart Accounts erstellen und wiederherstellen
---

`wallet_prepareSmartAccount` erstellt einen Pali Smart Account für Dapp-Onboarding. Pali leitet das Konto ab, deployed es über die konfigurierte Factory, installiert bei Bedarf den gewünschten Validator, verbindet das Konto mit der Dapp und speichert dauerhafte Metadaten lokal.

## Struktur

- **Factory:** berechnet deterministische Adressen und deployed Konten.
- **Smart Account:** führt Calls aus und fragt installierte Validatoren.
- **Validatoren:** ECDSA, P-256 WebAuthn Passkey und Composite.
- **Executors:** Guardian-Recovery für verzögerte Wiederherstellung.

## Recovery

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Pali settings screen for recovering smart accounts" />
</a>
  <figcaption>Der Recovery-Bildschirm hilft, den Smart-Account-Zugriff wiederherzustellen, indem Pali-erstellte Konten rekonstruiert werden oder Guardian-Recovery den aktiven Validator ersetzt.</figcaption>
</figure>

Recovery hängt von den installierten Modulen ab. Deterministische Konten können aus Wallet-Anchor, Chain, Index und Factory rekonstruiert werden. Passkey-Validatoren benötigen die relevante WebAuthn-Credential. Guardian-Recovery kann den aktiven Validator nach der konfigurierten Verzögerung ersetzen.

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>Recovery und Ausführung erfordern eine WebAuthn-Assertion der relevanten Passkey-Credential.</figcaption>
</figure>
