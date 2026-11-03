---
title: Dapps no estilo Bitcoin
---

O provider UTXO da Pali torna dapps de navegador possíveis para fluxos de conta no estilo Bitcoin, incluindo Syscoin UTXO e modelos de transação compatíveis.

## O que muda em relação à EVM

Dapps EVM geralmente pedem que uma conta assine um objeto de transação. Dapps UTXO geralmente:

1. Leem estado de conta e UTXO.
2. Constroem uma PSBT.
3. Incluem um endereço de troco.
4. Pedem que a carteira assine.
5. Finalizam e fazem broadcast.

## Formato mínimo de integração

Envie um objeto PSBT estruturado da Pali, não uma string Base64 bruta. `syscoinjs-lib` exporta `{ psbt: <base64>, assets: <string JSON> }`; forneça o mapa de ativos quando aplicável. `sys_sign` retorna um objeto assinado no mesmo formato, que pode permanecer parcialmente assinado. O campo `assets` retornado fica vazio; mantenha separadamente os metadados de ativos necessários.

```js
import { utils as sys } from 'syscoinjs-lib';

const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

// Supply your constructed syscoinjs PSBT and optional asset map.
const paliPsbt = sys.exportPsbtToJson(psbt, assetsMap);
const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [paliPsbt],
});
```

## Boas práticas

- Construa PSBTs deterministamente e mostre aos usuários um resumo da transação na sua aplicação.
- Use o endereço de troco da Pali em vez de reutilizar endereços de recebimento.
- Trate diferenças entre testnet/mainnet.
- Trate erros de carteira bloqueada, rejeição e incompatibilidade de rede.
- Evite solicitar xpub ou assinatura até que o usuário inicie uma ação significativa.
