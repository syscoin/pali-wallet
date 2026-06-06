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

Si l'état local du portefeuille est supprimé ou si Pali est installé sur un nouvel appareil, Pali peut récupérer les comptes intelligents passkey depuis le registre de factory on-chain et les journaux d'événements. Toute installation de Pali ayant accès au même credential passkey peut découvrir les comptes déployés correspondants après une assertion WebAuthn, ignorer les comptes déjà présents localement et importer les comptes sélectionnés.

## Récupération par gardiens

Pali utilise des gardiens de récupération en auto-garde pour la récupération des comptes passkey en production. Un gardien est un portefeuille EVM de secours, un compte importé ou un portefeuille matériel que l'utilisateur contrôle séparément de la passkey active. Tant que la passkey contrôle encore le compte, l'utilisateur peut ajouter ou retirer des gardiens et modifier le délai d'attente de récupération depuis l'écran de politique.

La récupération par gardiens n'est pas instantanée. Le démarrage de la récupération crée une passkey de remplacement, demande au gardien configuré de signer l'intention de récupération, puis soumet une demande de récupération temporisée. Une fois le délai d'attente écoulé, n'importe qui peut finaliser la transaction de récupération. L'utilisateur peut ensuite utiliser la récupération passkey normale pour importer le compte avec la passkey de remplacement.

La signature du gardien lie la chaîne, le validateur de récupération par gardiens, l'adresse du compte, l'identité de la passkey de remplacement, le nonce de récupération et l'expiration. Cela empêche de réutiliser une signature de gardien pour un autre compte, une autre chaîne ou une autre passkey, tout en permettant de relayer la transaction qui démarre la récupération.

Note technique : le validateur de récupération par gardiens stocke pour chaque compte un ensemble de gardiens, un seuil, un délai et une récupération en attente. Pali expose actuellement le flux simple 1-sur-1 pour plus de clarté UX, tandis que le contrat prend en charge des politiques à seuil comme 1-sur-N ou M-sur-N.

## Comptes créés par les dapps

Les dapps peuvent demander des métadonnées de récupération par gardiens pendant `wallet_createPasskeyAccount` :

```json
{
  "label": "Trading desk",
  "recovery": {
    "guardian": {
      "address": "0x...",
      "delay": 86400
    }
  }
}
```

Pali n'attache pas automatiquement un gardien fourni par une dapp lors de la création du compte, car le portefeuille ne peut pas encore authentifier cette adresse. Si une dapp suggère un gardien, Pali avertit l'utilisateur et lui permet de créer le compte ; l'utilisateur peut ensuite ajouter son propre gardien de confiance depuis l'écran de politique du compte passkey. De futures versions pourront ajouter un dictionnaire de confiance ou une liste blanche pour les gardiens par défaut connus.
