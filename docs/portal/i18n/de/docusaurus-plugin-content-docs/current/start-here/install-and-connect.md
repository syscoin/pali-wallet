---
title: Installieren und verbinden
---

Installieren Sie Pali als Browser-Erweiterung, entsperren Sie sie und öffnen Sie eine dapp. Pali injiziert Provider in Top-Level-Seiten, damit Anwendungen Accounts und Aktionen anfordern können.

## Pali erkennen

Verwenden Sie für EVM-Integrationen EIP-6963, wenn verfügbar. Damit können Benutzer und dapps Pali von anderen Wallets unterscheiden, selbst wenn mehrere Erweiterungen Provider injizieren.

```js
const providers = [];

window.addEventListener('eip6963:announceProvider', (event) => {
  providers.push(event.detail);
});

window.dispatchEvent(new Event('eip6963:requestProvider'));

const pali = providers.find(({ info }) => {
  const name = info.name.toLowerCase();
  const rdns = info.rdns.toLowerCase();
  return name.includes('pali') || rdns.includes('pali');
});
```

Prüfen Sie für UTXO- und Syscoin-Flows `window.pali`.

```js
if (!window.pali) {
  throw new Error('Pali UTXO provider is not available.');
}
```

## EVM-Accounts verbinden

<figure>
  <a className="pali-media-link" href="/img/screens/connect-dapp-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/connect-dapp-popup.png" alt="Pali dapp-Verbindungspopup mit anfragender Site und Account-Auswahl" />
</a>
  <figcaption>Pali zeigt die anfragende Site und den Account, bevor dapp-Zugriff gewährt wird.</figcaption>
</figure>

```js
const [address] = await window.ethereum.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## UTXO-Accounts verbinden

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Ablehnung und Netzwerkabweichung behandeln

Benutzer können Verbindungs-Requests ablehnen. Pali kann eine Methode auch ablehnen, wenn das aktive Netzwerk zur falschen Chain-Familie gehört, etwa wenn `sys_requestAccounts` aufgerufen wird, während sich die Wallet im EVM-Modus befindet.

```js
try {
  await window.pali.request({ method: 'sys_requestAccounts', params: [] });
} catch (error) {
  if (error.code === 4001) {
    console.log('The user rejected the request.');
  } else {
    console.error('Pali request failed', error);
  }
}
```

## Lokalen Entwicklungs-Build laden

<figure>
  <a className="pali-media-link" href="/img/screens/install-unlocked-wallet.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/install-unlocked-wallet.png" alt="Pali Wallet in einem sauberen Browserprofil installiert und entsperrt" />
</a>
  <figcaption>Verwenden Sie ein sauberes Testprofil, wenn Sie Installations- und Entsperr-Flows erfassen.</figcaption>
</figure>

Aus dem Wallet-Repository:

```bash
yarn install
yarn dev:chrome
```

Öffnen Sie anschließend `chrome://extensions`, aktivieren Sie den Entwicklermodus, wählen Sie Entpackte Erweiterung laden und wählen Sie das generierte Verzeichnis `build/chrome` aus.
