---
title: Transaktionen und Signatur
---

Verwenden Sie den EVM-Provider für Transaktionen, persönliche Nachrichten und typed data.

## Eine Transaktion senden

<figure>
  <a className="pali-media-link" href="/img/screens/evm-send-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/evm-send-review.png" alt="Pali-Prüfbildschirm für EVM-Transaktionen" />
</a>
  <figcaption>Transaktions-Requests werden in Pali vor Signatur und Broadcast geprüft.</figcaption>
</figure>

```js
const [from] = await window.ethereum.request({
  method: 'eth_requestAccounts',
});

const hash = await window.ethereum.request({
  method: 'eth_sendTransaction',
  params: [
    {
      from,
      to: '0x0000000000000000000000000000000000000000',
      value: '0x0',
      data: '0x',
    },
  ],
});
```

## Personal sign

```js
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: ['0x48656c6c6f2050616c69', from],
});
```

## Typed data sign

<figure>
  <a className="pali-media-link" href="/img/screens/typed-data-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/typed-data-review.png" alt="Pali-Prüfbildschirm für typed data-Signatur" />
</a>
  <figcaption>Pali validiert und zeigt typed data vor der Benutzerfreigabe an.</figcaption>
</figure>

```js
const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [from, JSON.stringify(typedData)],
});
```

Pali validiert die typed data-Struktur, bevor das Signatur-Popup angezeigt wird. dapps sollten kanonisches EIP-712-JSON verwenden und vermeiden, sich auf wallet-spezifische Parsing-Eigenheiten zu verlassen.

## Smart Accounts und Signatur

Pali Smart Accounts geben Transaktionen und Signatur-Flows über das aktive Validator-Modul frei. Der Benutzer bestätigt weiterhin in Pali. Wenn der Validator passkey-basiert ist, zeigt der Browser oder das Betriebssystem zusätzlich einen WebAuthn-Prompt.
