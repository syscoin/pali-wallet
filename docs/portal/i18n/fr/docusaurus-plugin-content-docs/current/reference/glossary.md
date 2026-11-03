---
title: Glossaire
---

## Famille de compte

Le modèle de compte de portefeuille utilisé par un réseau. Les comptes EVM sont basés sur des comptes. Les comptes Syscoin UTXO et de style Bitcoin sont basés sur UTXO.

## EIP-1193

L'interface standard de provider JavaScript utilisée par les portefeuilles Ethereum via `provider.request()`.

## EIP-6963

Un standard de découverte multi-portefeuille qui permet aux dapps de découvrir des providers sans dépendre uniquement de `window.ethereum`.

## Compte intelligent passkey

Un compte intelligent EVM contrôlé par un credential WebAuthn au lieu d'une clé privée EOA normale.

## PSBT

Partially Signed Bitcoin Transaction. Un format courant pour coordonner la signature de transactions UTXO.

## Service de sponsor

Un service opéré par une institution qui peut fournir un sponsoring du gaz, une prise en charge de relais ou une coautorisation requise pour l'exécution d'un compte intelligent passkey.

## SPT

Syscoin Platform Token, un actif du côté Syscoin UTXO.

## UTXO

Unspent Transaction Output. Le modèle de compte utilisé par les chaînes de type Bitcoin et Syscoin UTXO.

## WebAuthn

Le standard de navigateur derrière les passkeys. Il permet aux utilisateurs d'approuver des actions cryptographiques via des authenticators de plateforme, des clés matérielles ou des fournisseurs de passkey synchronisées.

## SLH-DSA

Le signataire local utilise **SLH-DSA-SHA2-128-24**, un profil expérimental à nombre limité de signatures proposé dans le projet initial [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd). Il ne s’agit pas d’un jeu de paramètres à usage général approuvé par FIPS 205. Sur les réseaux configurés, Pali prend en charge ECDSA, les passkeys P-256 WebAuthn, SLH-DSA et les validateurs composites ; les modules compatibles doivent être déployés et les clés ou identifiants locaux nécessaires disponibles.
