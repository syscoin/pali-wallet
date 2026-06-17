---
title: SLH-DSA Smart Accounts
---

Pali Smart Accounts unterstuetzen modulare Validatoren. Der Post-Quantum-Validator verwendet lokale **SLH-DSA-SHA2-128s**-Signaturen, die von Pali verwaltet werden. In APIs lautet die Authenticator-ID `slh-dsa`.

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
