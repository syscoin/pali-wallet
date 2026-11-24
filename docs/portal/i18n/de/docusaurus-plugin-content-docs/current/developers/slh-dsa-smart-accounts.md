---
title: SLH-DSA Smart Accounts
---

Pali Smart Accounts unterstuetzen modulare Validatoren. Der Post-Quantum-Validator verwendet lokale **SLH-DSA-SHA2-128-24**-Signaturen, die von Pali verwaltet werden. In APIs lautet die Authenticator-ID `slh-dsa`.

Der lokale Signierer verwendet **SLH-DSA-SHA2-128-24**, ein experimentelles Profil mit begrenzter Signaturzahl aus dem ersten Entwurf von [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd). Es ist kein in FIPS 205 für allgemeine Verwendung zugelassener Parametersatz. Die Grenze von `2^24` Signaturen gilt über die gesamte Lebensdauer des Schlüssels für alle Nutzungen und Kopien zusammen. Pali reserviert `1,000` Signaturen für die Rotation; normales Signieren endet bei `2^24 - 1,000` lokal erfassten Signaturen. Die Neuerzeugung erhält lokal verfügbare Nutzungsdaten; eine Wiederherstellung nur aus der Seed-Phrase oder einem älteren Backup stellt fehlende Daten nicht wieder her, und Geräte synchronisieren ihre Zähler nicht. Die globale Grenze ist in diesen Fällen daher nicht sichergestellt.

Wenn du die Gesamtzahl der Signaturen dieses Schlüssels nicht kennst, verwende ihn auf keinem Gerät mehr für reguläre Signaturen. Richte vor dem nächsten regulären Signieren einen neuen SLH-DSA-Schlüssel in einem neuen Pali-Smart-Account mit einem bisher unbenutzten Kontoindex ein. Mit derselben Seed-Phrase und demselben Kontoindex erzeugt die Wiederherstellung des Signierers wieder den ursprünglichen Schlüssel.

Nach einer Wiederherstellung kann Pali einen Kontoindex vorschlagen, den du schon verwendet hast. Wenn du nicht feststellen kannst, ob ein Index für diese Seed-Phrase noch unbenutzt ist, erstelle eine separate Wallet mit einer neu generierten Seed-Phrase und richte dort den SLH-DSA-Signierer ein. Verwende ein anderes Browserprofil oder Gerät, damit du während der Übertragung deiner Vermögenswerte und der Aktualisierung der Berechtigungen des alten Kontos weiterhin auf die ursprüngliche Wallet und ihre Wiederherstellungsoptionen zugreifen kannst.

:::caution Alpha-Hinweis
Pali Smart Accounts und SLH-DSA sind fruehe Infrastruktur. Nutze zuerst unterstuetzte Testnetze oder kleine Betraege, behalte Wiederherstellung oder einen Ersatzvalidator bei und baue keine Dapp-UX auf festen Einrichtungs- oder Signaturzeiten auf.
:::

## Dapp-Anfrage

Fordere einen Smart Account mit `wallet_prepareSmartAccount` an:

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Post-Quantum-Testkonto',
      authenticator: { id: 'slh-dsa' },
    },
  ],
});
```

Fuege kein `keyId`, `pkSeed`, `pkRoot` oder anderes SLH-DSA-Schluesselmaterial hinzu. Pali erzeugt und verwaltet den lokalen Signierer. Von Dapps gelieferte SLH-DSA-Schluessel werden abgelehnt, damit keine Konten entstehen, die Pali nicht signieren kann.

## Signaturablauf

Pali signiert den Smart-Account-Action-Hash mit dem lokalen SLH-DSA-Signierer. Vor dem Signieren prueft Pali das Zielkonto, hydrierte Metadaten, den aktiven Validator `slh-dsa`, den passenden oeffentlichen Schluessel und ob die Sitzung den lokalen Zustand entschluesseln kann.

Wenn eine Pruefung fehlschlaegt, signiert Pali nicht und fordert dazu auf, den lokalen Zustand neu zu erzeugen oder eine andere Genehmigungsmethode zu verwenden.

## Limits und Gas

- absolute Kapazitaet pro Schluessel: `2^24`;
- normales Signaturlimit: `2^24 - 1,000`;
- fuer Rotation reservierte Signaturen: `1,000`;
- Signaturgroesse: `3,856` Byte;
- SLH-DSA `preVerificationGas`: `130,000`;
- SLH-DSA `verificationGasLimit`: `700,000` als konservative Obergrenze.

Wenn `signatureCount >= signatureLimit`, signiert Pali keine normalen Operationen mehr mit diesem Schluessel und erlaubt das reservierte Budget nur fuer explizite `rotateValidator`-Ausfuehrungen. Dapps sollten keine festen Signaturzeiten annehmen.

## Referenzen

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
