---
title: Confidentialité et sécurité
---

Pali est conçu pour minimiser ce que les dapps peuvent apprendre sans action explicite de l'utilisateur.

## Ce que Pali n'expose pas

Pali n'expose pas aux pages web les phrases de récupération, les clés privées, le matériel privé passkey, les mots de passe du portefeuille ni les listes de comptes sans restriction.

## Ce que les dapps peuvent demander

Les dapps peuvent demander des adresses de compte publiques, l'état du provider, l'état du réseau, des signatures, des approbations de transaction, la signature PSBT, des approbations de suivi d'actifs, le changement de chaîne, la création de compte passkey et l'exécution groupée.

## Sécurité des connexions

Connectez-vous uniquement aux dapps auxquelles vous faites confiance. Une dapp connectée peut voir le compte que vous avez approuvé pour cette origine et peut demander de futures actions. Vous pouvez révoquer l'accès d'un site depuis le portefeuille.

## Données blockchain publiques

L'activité blockchain est publique. Votre adresse, votre historique de transactions, vos approbations de jetons, votre activité UTXO, le déploiement de compte intelligent et l'activité de compte intelligent passkey peuvent être visibles sur des explorers et des indexeurs.

## Confidentialité des passkeys institutionnelles

Si une dapp ou une institution fournit une URL de sponsor, ce service peut recevoir des demandes de sponsor liées à l'exécution du compte. Examinez le texte de politique de l'institution et l'URL avant d'approuver.
