---
title: Post-Quantum-Signierer fuer Smart Accounts
---

Pali Smart Accounts koennen verschiedene Validatoren verwenden. Einer davon ist ein lokaler Post-Quantum-Signierer auf Basis von **SLH-DSA-SHA2-128s**, einer hashbasierten Signaturfamilie, die vom NIST in FIPS 205 standardisiert wurde.

Einfach gesagt: Ein Smart Account kann damit Aktionen mit einem Signaturverfahren genehmigen, das gegen bekannte Quantenangriffe auf heutige ECDSA-Signaturen ausgelegt ist.

:::caution Alpha-Hinweis
Pali Smart Accounts und der SLH-DSA-Validator sind fruehe Infrastruktur. Beginne auf unterstuetzten Testnetzen oder mit kleinen Betraegen, behalte einen Wiederherstellungs- oder Ersatzvalidator bei und rechne mit langsamerer Einrichtung und Signatur als bei normalen Wallet-Signaturen.
:::

## Was sich aendert

Bei einem normalen EVM-Konto kontrolliert ein ECDSA-Private-Key die Adresse. Bei einem Smart Account ist die Adresse ein Vertrag, und ein Validator entscheidet, was als Genehmigung zaehlt. Dieser Validator kann ECDSA, Passkey, eine zusammengesetzte Richtlinie oder SLH-DSA sein.

Was gleich bleibt:

- Die Smart-Account-Adresse bleibt gleich.
- Dapps sehen weiterhin eine EVM-Adresse.
- Pali zeigt weiterhin eine Anfrage zur Pruefung vor dem Signieren.
- Guardian Recovery und Validator-Rotation bleiben verfuegbar.

Was sich aendert:

- Die Einrichtung dauert laenger, weil Pali einen lokalen Cache vorbereitet.
- Signieren kann laenger dauern als ECDSA oder Passkeys.
- Der lokale Signiererzustand muss auf dem Geraet verfuegbar sein oder neu erzeugt werden.

## Aktivierung

1. Oeffne Pali und wechsle zu einem unterstuetzten EVM-Netzwerk.
2. Oeffne **Settings**.
3. Oeffne den Smart-Account- oder Policy-Bildschirm.
4. Waehle **Post-quantum / SLH-DSA**.
5. Lass Pali offen, waehrend der Cache vorbereitet wird.
6. Pruefe und sende die Transaktion zum Validatorwechsel.

Wenn Pali meldet, dass der lokale Signierer fehlt oder nicht zum aktiven Validator passt, erzeuge den Signiererzustand im Policy-Bildschirm neu.

## Signaturlimit

Das aktuelle SLH-DSA-Profil hat eine absolute Kapazitaet von `2^24` Signaturen pro vorbereitetem lokalen Signierer. Pali reserviert `1,000` Signaturen fuer Rotationsversuche weg von diesem Schluessel, daher stoppt normales Signieren bei `2^24 - 1,000`. Das sind weiterhin mehr als 16 Millionen Signaturen, sodass normale Nutzer dieses Limit voraussichtlich nicht erreichen.

Wenn das normale Budget erschoepft ist, signiert Pali keine normalen Operationen mehr mit diesem Schluessel und bewahrt die Reserve fuer Validator-Rotationsversuche auf. Pali signiert nicht stillschweigend mit einem erschoepften Signierer.

## Referenzen

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [NIST Post-Quantum-Kryptografieprojekt](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
