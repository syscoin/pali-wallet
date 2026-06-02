---
title: Dapps de style Bitcoin
---

Le provider UTXO de Pali rend possibles les dapps de navigateur pour les flux de comptes de style Bitcoin, y compris Syscoin UTXO et les modèles de transaction compatibles.

## Ce qui change par rapport à EVM

Les dapps EVM demandent généralement à un compte de signer un objet de transaction. Les dapps UTXO généralement :

1. Lisent l'état du compte et des UTXO.
2. Construisent un PSBT.
3. Incluent une adresse de rendu de monnaie.
4. Demandent au portefeuille de signer.
5. Finalisent et diffusent.

## Forme minimale d'intégration

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
});

const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});

const signedPsbt = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Bonnes pratiques

- Construisez les PSBTs de manière déterministe et affichez aux utilisateurs un résumé de transaction dans votre app.
- Utilisez l'adresse de rendu de monnaie de Pali au lieu de réutiliser des adresses de réception.
- Gérez les différences testnet/mainnet.
- Gérez les erreurs de portefeuille verrouillé, de rejet et d'incompatibilité de réseau.
- Évitez de demander un xpub ou une signature jusqu'à ce que l'utilisateur initie une action significative.
