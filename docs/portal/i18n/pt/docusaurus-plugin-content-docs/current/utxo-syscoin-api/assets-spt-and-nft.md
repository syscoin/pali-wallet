---
title: Auxiliares de ativos, SPT e NFT
---

A Pali expõe auxiliares de ativos Syscoin por meio do provider UTXO e da API auxiliar `_sys`.

## Obter tokens da carteira

```js
const tokens = await window.pali.request({
  method: 'wallet_getTokens',
});
```

## Obter metadados de ativo Syscoin

```js
const metadata = await window.pali.request({
  method: 'wallet_getSysAssetMetadata',
  params: [assetGuid],
});
```

## Usar auxiliares `_sys`

```js
const minted = await window.pali._sys.getUserMintedTokens();
const holdings = await window.pali._sys.getHoldingsData();
const dataAsset = await window.pali._sys.getDataAsset(assetGuid);
```

## Verificações de NFT

O auxiliar `_sys.isNFT(guid)` está disponível na camada de utilitários do provider injetado. O método de request `sys_isNFT` está registrado no catálogo de métodos da carteira, mas a cobertura da implementação atual deve ser validada antes de depender dele em produção.

## Orientação de UX de ativos

Mostre nomes, símbolos, quantias e GUIDs de ativos claramente antes de pedir que usuários assinem transações UTXO de ativos. Fluxos de ativos UTXO são menos padronizados que fluxos de tokens ERC, então dapps não devem presumir que a UI da carteira consegue inferir todos os detalhes.
