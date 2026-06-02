---
title: Visão geral da API UTXO e Syscoin
---

A Pali expõe capacidades UTXO e Syscoin por meio de `window.pali`.

Use este provider quando sua aplicação precisa de:

- Acesso a conta Syscoin UTXO.
- Assinatura PSBT.
- Broadcast de transação.
- Endereços de troco.
- xpub da conta conectada.
- Histórico de transações UTXO.
- Metadados e saldos de ativos Syscoin Platform Token.

## Conectar

<figure>
  <a className="pali-media-link" href="/img/screens/utxo-connect-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/utxo-connect-popup.png" alt="Popup de conexão UTXO da Pali para uma dapp Syscoin" />
</a>
  <figcaption>Dapps UTXO se conectam por meio de <code>window.pali</code>, não <code>window.ethereum</code>.</figcaption>
</figure>

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Utilitários do provider

`window.pali` inclui métodos RPC baseados em request e métodos auxiliares `_sys` para leituras comuns de ativos Syscoin.

```js
const xpub = window.pali._sys.getConnectedAccountXpub();
const changeAddress = await window.pali._sys.getChangeAddress();
const holdings = await window.pali._sys.getHoldingsData();
```

## Regras de família de chain

Métodos UTXO exigem que a carteira esteja em um contexto de rede UTXO/Syscoin compatível. Se sua aplicação também oferece suporte a EVM, mantenha as chamadas de provider separadas e trate a troca de modo explicitamente.
