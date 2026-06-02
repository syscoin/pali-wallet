---
title: Bien démarrer comme utilisateur
---

Pali vous permet de gérer des comptes EVM, des comptes Syscoin UTXO et des comptes intelligents passkey depuis une seule extension.

## Configuration de base

1. Installez l'extension Pali.
2. Créez un nouveau portefeuille ou importez une phrase de récupération existante.
3. Définissez un mot de passe fort.
4. Sauvegardez votre phrase de récupération hors ligne.
5. Choisissez le réseau que vous voulez utiliser.
6. Connectez-vous uniquement aux dapps auxquelles vous faites confiance.

## Connexion à une dapp

Lorsqu'un site demande l'accès, Pali ouvre une popup de connexion qui affiche le site et vous permet de choisir le compte. Une dapp ne reçoit que l'adresse du compte connecté et l'état du provider approuvé.

Pali stocke les connexions par site. Vous pouvez connecter différents sites à différents comptes, mais chaque site a un seul compte actif à la fois.

## Comptes EVM

Utilisez les comptes EVM pour les chaînes compatibles Ethereum, Rollux, Syscoin NEVM et les dapps qui s'attendent à un comportement de portefeuille de style MetaMask.

Les dapps EVM peuvent demander :

- accès au compte
- transactions
- signatures personnelles
- signatures de données typées
- demandes de suivi de jeton
- demandes d'ajout/changement de chaîne
- demandes d'appels groupés

## Comptes UTXO

Utilisez les comptes UTXO pour Syscoin UTXO et les flux de transaction de style Bitcoin. Les dapps UTXO peuvent demander un état tenant compte du xpub, des adresses de rendu de monnaie, la signature PSBT et la diffusion de transactions.

## Comptes intelligents passkey

Les comptes passkey sont des comptes intelligents contrôlés par des identifiants WebAuthn. Ils peuvent être utiles pour l'intégration gérée par des institutions, la récupération de compte et l'exécution sponsorisée. Certains comptes passkey sont contrefactuels jusqu'à leur première transaction de déploiement.
