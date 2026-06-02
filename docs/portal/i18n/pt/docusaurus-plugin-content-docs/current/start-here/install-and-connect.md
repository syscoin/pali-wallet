---
title: Instalar e conectar
---

Instale a Pali como uma extensão de navegador, desbloqueie-a e abra uma dapp. A Pali injeta providers em páginas de nível superior para que aplicações possam solicitar contas e ações.

## Detectar a Pali

Use EIP-6963 quando disponível para integrações EVM. Ele permite que usuários e dapps distingam a Pali de outras carteiras mesmo quando várias extensões injetam providers.

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

Para fluxos UTXO e Syscoin, verifique `window.pali`.

```js
if (!window.pali) {
  throw new Error('Pali UTXO provider is not available.');
}
```

## Conectar contas EVM

<figure>
  <a className="pali-media-link" href="/img/screens/connect-dapp-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/connect-dapp-popup.png" alt="Popup de conexão de dapp da Pali mostrando o site solicitante e a seleção de conta" />
</a>
  <figcaption>A Pali mostra o site solicitante e a conta antes de conceder acesso à dapp.</figcaption>
</figure>

```js
const [address] = await window.ethereum.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## Conectar contas UTXO

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Tratar rejeição e incompatibilidade de rede

Usuários podem rejeitar solicitações de conexão. A Pali também pode rejeitar um método quando a rede ativa é da família de chain errada, como chamar `sys_requestAccounts` enquanto a carteira está no modo EVM.

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

## Carregar uma build local de desenvolvimento

<figure>
  <a className="pali-media-link" href="/img/screens/install-unlocked-wallet.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/install-unlocked-wallet.png" alt="Pali Wallet instalada e desbloqueada em um perfil de navegador limpo" />
</a>
  <figcaption>Use um perfil de teste limpo ao capturar fluxos de instalação e desbloqueio.</figcaption>
</figure>

A partir do repositório da carteira:

```bash
yarn install
yarn dev:chrome
```

Depois abra `chrome://extensions`, habilite Developer Mode, escolha Load unpacked e selecione o diretório gerado `build/chrome`.
