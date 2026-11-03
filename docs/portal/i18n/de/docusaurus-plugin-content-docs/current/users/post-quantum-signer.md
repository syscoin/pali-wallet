---
title: Post-Quantum-Signierer fuer Smart Accounts
---

Der lokale Signierer verwendet **SLH-DSA-SHA2-128-24**, ein experimentelles Profil mit begrenzter Signaturzahl aus dem ersten Entwurf von [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd). Es ist kein in FIPS 205 für allgemeine Verwendung zugelassener Parametersatz.

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

Die Grenze von `2^24` Signaturen gilt über die gesamte Lebensdauer des Schlüssels für alle Nutzungen und Kopien zusammen. Pali reserviert `1,000` Signaturen für die Rotation; normales Signieren endet bei `2^24 - 1,000` lokal erfassten Signaturen. Die Neuerzeugung erhält lokal verfügbare Nutzungsdaten; eine Wiederherstellung nur aus der Seed-Phrase oder einem älteren Backup stellt fehlende Daten nicht wieder her, und Geräte synchronisieren ihre Zähler nicht. Die globale Grenze ist in diesen Fällen daher nicht sichergestellt.

Wenn das normale Budget erschoepft ist, signiert Pali keine normalen Operationen mehr mit diesem Schluessel und bewahrt die Reserve fuer Validator-Rotationsversuche auf. Pali signiert nicht stillschweigend mit einem erschoepften Signierer.

## Referenzen

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [NIST Post-Quantum-Kryptografieprojekt](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
