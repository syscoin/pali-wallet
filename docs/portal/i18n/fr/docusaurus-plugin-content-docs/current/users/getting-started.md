---
title: Bien démarrer comme utilisateur
---

Pali vous permet de gérer des comptes EVM, des comptes Syscoin UTXO et des comptes intelligents modulaires depuis une seule extension.

## Configuration de base

1. Installez l'extension Pali.
2. Créez un nouveau portefeuille ou importez une phrase de récupération existante.
3. Définissez un mot de passe fort.
4. Sauvegardez votre phrase de récupération hors ligne.
5. Choisissez le réseau que vous voulez utiliser.
6. Connectez-vous uniquement aux dapps auxquelles vous faites confiance.

## Configuration et chargement

Gardez la configuration inachevée ouverte et visible. La quitter, la masquer ou la recharger efface les données sensibles saisies et peut vous obliger à recommencer. Conservez la phrase de récupération que vous avez sauvegardée.

Si Pali ne peut pas confirmer que la création du portefeuille est terminée, laissez-le se recharger et vérifier le portefeuille. Si un écran de déverrouillage apparaît, utilisez le mot de passe que vous venez de définir. Ne supposez pas qu’une réponse interrompue signifie qu’aucun portefeuille n’a été créé et ne relancez pas immédiatement la création.

Pendant une opération lente, Pali peut afficher des options de récupération tout en laissant la navigation disponible. Les actions sensibles attendent toujours que le compte et le réseau se stabilisent. Recevoir masque temporairement l’adresse, le code QR et le bouton de copie ; les demandes au faucet attendent également. Vérifiez à nouveau le compte et le réseau avant de continuer.

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

Pour rechercher ou ajouter des actifs, consultez [Détection de jetons et API d’explorateurs](./token-discovery-and-explorer-apis). Ce guide décrit les importations manuelles, les formats d’API pris en charge, les paramètres réseau et les limites d’accès des fournisseurs.

## Comptes UTXO

Utilisez les comptes UTXO pour Syscoin UTXO et les flux de transaction de style Bitcoin. Les dapps UTXO peuvent demander un état tenant compte du xpub, des adresses de rendu de monnaie, la signature PSBT et la diffusion de transactions.

## Comptes intelligents

Les comptes intelligents sont des comptes de contrat contrôlés par des modules. Pali peut créer des comptes contrôlés par un validateur de passkey, un validateur ECDSA du portefeuille ou une politique de gestion partagée. Ils sont utiles pour l’intégration aux dapps, les actions groupées et la récupération par des gardiens. Certains comptes intelligents sont contrefactuels jusqu’à leur première transaction de déploiement.
