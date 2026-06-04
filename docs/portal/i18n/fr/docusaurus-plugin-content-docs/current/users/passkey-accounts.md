---
title: Comptes passkey
---

Les comptes passkey sont des comptes intelligents EVM contrôlés par des identifiants WebAuthn. Au lieu de signer avec une clé privée EOA normale, l'utilisateur approuve les actions avec l'interface de passkey d'appareil ou de compte fournie par le navigateur et le système d'exploitation.

En coulisse, les passkeys WebAuthn utilisent des signatures P-256. Les comptes passkey zkSYS sont conçus pour que ces preuves P-256 puissent être vérifiées par le système de compte intelligent/factory, ce qui explique pourquoi une validation biométrique ou par passkey de plateforme peut autoriser une action on-chain.

## Pourquoi utiliser un compte passkey ?

- Intégration institutionnelle plus simple.
- Prise en charge des politiques de compte intelligent.
- Services de sponsor optionnels pour le gaz ou la coautorisation.
- Exécution groupée avec une seule approbation utilisateur.
- Récupération depuis les données du registre on-chain lorsque les métadonnées locales du portefeuille manquent.

## Passkeys partagées et séparées

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-create.png" alt="Écran des paramètres de Pali pour créer un compte passkey" />
</a>
  <figcaption>Les utilisateurs peuvent créer des comptes passkey depuis Settings ainsi que depuis les demandes de dapp.</figcaption>
</figure>

Pali peut utiliser un profil passkey de portefeuille partagé ou créer un credential passkey séparé pour un compte. Les passkeys partagées sont pratiques pour les utilisateurs qui veulent une passkey contrôlée par le portefeuille. Les passkeys séparées peuvent aider les institutions à isoler les credentials par service ou par politique.

## Déploiement

Un compte intelligent passkey peut exister comme adresse contrefactuelle avant d'être déployé on-chain. La première exécution peut déployer le compte et effectuer l'action demandée dans un seul flux si le réseau et le chemin de financement le prennent en charge.

Si le compte n'est pas encore déployé, assurez-vous que le compte passkey ou le payeur du gaz de déploiement dispose de suffisamment de jeton natif, ou utilisez un chemin de sponsor institutionnel qui prend en charge le flux de déploiement.

## Prise en charge réseau

Les comptes passkey exigent des contrats de compte intelligent passkey zkSYS et la prise en charge de la vérification P-256. Dans cette version de Pali, le testnet `zkTanenbaum` est configuré pour la création de comptes passkey. La prise en charge de zkSYS en production utilise le même modèle une fois que l'adresse de factory de production est configurée dans le portefeuille.

## Récupération

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-policy.png" alt="Écran des paramètres de politique de compte passkey de Pali" />
</a>
  <figcaption>L'écran de politique passkey affiche le mode sponsor, le signataire, l'URL et l'état de sauvegarde lorsqu'ils sont disponibles.</figcaption>
</figure>

Si l'état local du portefeuille est supprimé ou si Pali est installé sur un nouvel appareil, Pali peut récupérer les comptes intelligents passkey depuis le registre de factory on-chain et les journaux d'événements. Toute installation de Pali ayant accès au même credential passkey peut importer les comptes déployés correspondants après une assertion WebAuthn.
