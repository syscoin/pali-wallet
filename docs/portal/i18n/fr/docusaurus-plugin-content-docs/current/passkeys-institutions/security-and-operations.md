---
title: Sécurité et opérations
---

Les comptes intelligents Pali doivent être traités comme une infrastructure de compte. Le contrat détient les actifs et les modules installés décident qui peut les déplacer.

## Dépendances

La chaîne doit avoir la factory et les modules Pali aux adresses utilisées par Pali. Sur les réseaux EVM compatibles avec le déployeur CREATE2 canonique, Pali peut déployer cette configuration depuis le portefeuille : Settings, Advanced, **Smart account setup**, Deploy. Les validateurs passkey ont aussi besoin de la vérification P-256 WebAuthn.

## Checklist opérationnelle

- Choisissez le validateur qui contrôle le compte : passkey, ECDSA ou composite, avec une récupération distincte si elle est configurée.
- Traitez les propriétaires ECDSA externes comme un risque élevé.
- Définissez les gardiens, le seuil et le délai de récupération.
- Approvisionnez le compte qui paie le gas.
- Surveillez les échecs de déploiement ou d’installation de modules et les récupérations expirées.

Pali collecte actuellement les approbations des validateurs enfants intégrés disponibles localement jusqu’au seuil. Cette version ne prend pas en charge les composites imbriqués ni la collecte d’approbations externes ou entre appareils. La récupération par gardiens reste indépendante de la politique du validateur actif.

Lors de la conception d'une politique composite, documentez la justification du seuil : 1-of-N optimise la disponibilité, N-of-N optimise l'assurance et t-of-N équilibre les deux. Les validateurs sont des modules remplaçables, donc la politique (et même le schéma de signature — y compris de futurs validateurs post-quantiques) peut être mise à niveau plus tard sans changer l'adresse du compte. Les gardiens sont un module de rôle exécuteur et restent indépendants de la politique de validateurs active.

## Recovery

Le parcours guidé de récupération par gardiens de Pali remplace le validateur actif après un délai. La méthode précédente reste active jusqu’à la finalisation confirmée. Toutefois, l’exécuteur on-chain peut exécuter des actions du compte approuvées par les gardiens et n’est pas limité au remplacement de validateur de l’interface ; les hooks installés peuvent ajouter des restrictions. Un seuil de gardiens compromis menace le contrôle et les fonds. Le module installé exige des approbations valides ; Pali utilise un nouveau salt par tentative et le contrat n’autorise qu’une opération active non expirée par compte.

:::tip Guide actuel de récupération par gardiens

Le [guide complet](../users/smart-account-validators#guardian-recovery-guide) explique la configuration, le lancement, la finalisation et **Disable guardian recovery**. Les nouvelles politiques proposent 3 ou 7 jours d’attente ; 10 minutes est réservé aux testnets connus. La désactivation confirmée exige la méthode d’approbation actuelle et du gas, invalide les récupérations en attente et supprime cette voie de récupération, mais n’annule pas une récupération finalisée. En cas de transaction incertaine, vérifiez d’abord son état on-chain. Les alertes facultatives de Sysnode exigent un e-mail vérifié et une signature du portefeuille ; elles ne reçoivent aucune clé et ne garantissent pas la livraison.

:::
