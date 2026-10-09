---
title: PSBT und Transaktionen
---

UTXO-Anwendungen sollten Transaktionen sorgfältig erstellen, eine Signatur über Pali anfordern und erst nach der Nutzerfreigabe senden.

## Eine PSBT signieren

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__chip">UTXO • Syscoin</p>
      <p className="pali-capture-card__title">PSBT-Signaturprüfung</p>
      <p className="pali-capture-card__subtitle">Bestätigung einer UTXO-Signatur</p>
      <p className="pali-capture-card__hint">Scrollen Sie innerhalb der Vorschau, um Outputs, Inputs, Größe, Gewicht und Sperrzeit zu prüfen.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Pali-Prüfbildschirm für eine PSBT-Signatur" />
    </div>
  </div>
  <figcaption>Pali fragt den Nutzer, bevor UTXO-PSBTs signiert werden.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Signieren und senden

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Transaktionen abrufen

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Eine Adresse validieren

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Verantwortung der Dapp

Pali signiert, was der Nutzer freigibt. Ihre Anwendung ist dafür verantwortlich, sinnvolle PSBT-Inputs, Outputs, Gebühren, Wechselgeld und Asset-Metadaten zu erstellen, bevor sie eine Signatur anfordert.

## Kontoauswahl

Das Signieren ist an das mit der anfragenden Dapp verbundene Konto und das freigegebene Netzwerk gebunden. PSBT-Metadaten können kein anderes Wallet-Konto auswählen. Zeigt Pali ein anderes Konto an, kann es den Nutzer vor der Freigabe auffordern, zum verbundenen Konto zu wechseln. Um ein anderes Konto zu verwenden, ändern Sie die Dapp-Verbindung und fordern Sie eine neue Freigabe an.

Bei einer PSBT mit noch nicht finalisierten Inputs muss mindestens ein noch nicht finalisierter Input zum freigegebenen Konto gehören. Pali signiert nur die Inputs dieses Kontos. Gemeinsame Transaktionen und Multisig-Transaktionen können daher teilweise signiert zurückgegeben werden; die anderen Beteiligten müssen ihre eigenen Inputs oder Signaturen vervollständigen. Vorhandene externe Signaturen und unterstützte finalisierte Inputs bleiben erhalten. Eine vollständig finalisierte PSBT kann zurückgegeben werden, ohne Signaturen hinzuzufügen. Die Unterstützung von Hardware-Wallets hängt weiterhin vom Gerät und Transaktionsformat ab.

Ein Konto- oder Netzwerkwechsel macht den ausstehenden Signierkontext ungültig. Erstellen oder prüfen Sie die Anfrage erneut und holen Sie eine neue Freigabe ein, statt die alte Anfrage erneut auszuführen.
