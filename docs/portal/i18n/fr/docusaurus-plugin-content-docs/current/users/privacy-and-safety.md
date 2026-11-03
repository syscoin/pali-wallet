---
title: Confidentialité et sécurité
---

Pali est conçu pour minimiser ce que les dapps peuvent apprendre sans action explicite de l'utilisateur.

## Ce que Pali n'expose pas

Pali n'expose pas aux pages web les phrases de récupération, les clés privées, le matériel privé passkey, les mots de passe du portefeuille ni les listes de comptes sans restriction.

## Ce que les dapps peuvent demander

Les dapps peuvent demander des adresses de compte publiques, l'état du provider, l'état du réseau, des signatures, des approbations de transaction, la signature PSBT, des approbations de suivi d'actifs, le changement de chaîne, la création de compte intelligent et l'exécution groupée.

## Sécurité des connexions

Connectez-vous uniquement aux dapps auxquelles vous faites confiance. Une dapp connectée peut voir le compte que vous avez approuvé pour cette origine et peut demander de futures actions. Vous pouvez révoquer l'accès d'un site depuis le portefeuille.

## Données blockchain publiques

L'activité blockchain est publique. Votre adresse, votre historique de transactions, vos approbations de jetons, votre activité UTXO, le déploiement de compte intelligent et l'activité de compte intelligent peuvent être visibles sur des explorers et des indexeurs.

## Fournisseurs de services réseau

Les fournisseurs RPC et Blockbook sélectionnés reçoivent les adresses de compte et les requêtes ou diffusions de transactions nécessaires à vos actions. Les requêtes de compte UTXO peuvent inclure une clé publique étendue (xpub). Les services de découverte de jetons, explorateurs, prix, découverte de réseaux et assistance matérielle reçoivent des requêtes selon l’opération. Ces services peuvent aussi voir votre adresse IP et les horaires des requêtes. Les dapps connectées reçoivent les comptes publics que vous approuvez et les signatures que vous autorisez.

## Notes privées

Cette fonction utilise quatre pools ETH fixes Tornado Classic (0,1, 1, 10 et 100 ETH) sur Ethereum mainnet ; elle ne rend pas privées les activités ordinaires du portefeuille. Un dépôt ou retrait direct exige un compte HD logiciel ou importé capable de signer. Un compte importé en lecture seule peut fournir le contexte d’un retrait par relayer ; les comptes matériels et intelligents ne sont pas pris en charge pour ces opérations. Un retrait direct relie publiquement le payeur du gas au destinataire. Un relayer a ses propres frais et risques de confiance. Ni l’anonymat ni la confidentialité post-quantique ne sont garantis.

Une note privée est un secret au porteur : quiconque la possède peut retirer. Tant que le portefeuille est déverrouillé et que vous connaissez son mot de passe, utilisez **Afficher pour sauvegarder** pour chaque note enregistrée et gardez les sauvegardes secrètes et en sécurité. La phrase de récupération seule ne restaure pas les notes générées après une récupération, une réinitialisation ou un changement d’installation.

Le service de confidentialité fournit les données publiques des pools et l’annuaire des relayers ; le RPC Ethereum sélectionné et le point d’accès du relayer choisi sont distincts. Le service par défaut est `https://sysnode.info`. Le réglage accepte une origine HTTPS, ou HTTP sur `localhost` ou `127.0.0.1`, sans chemin, identifiants, requête ni fragment. Changer de service efface les données publiques préparées : préparez à nouveau le pool ; les notes enregistrées restent présentes. Les fournisseurs peuvent observer votre adresse IP et les horaires des requêtes.

Pali peut utiliser le service de confidentialité par défaut ou votre propre service Sysnode. Pour exécuter votre service, consultez le [guide Sysnode](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md).

La limite par défaut est de 128 notes enregistrées (jusqu’à 4 MiB). Dans **Capacité des notes**, vous pouvez choisir 256 (jusqu’à 8 MiB) ou 512 (jusqu’à 16 MiB) ; une limite supérieure peut utiliser plus de stockage local et ralentir les opérations du coffre. Modifier la limite ne supprime aucune note, mais les anciennes versions du portefeuille pourraient ne pas lire le format mis à jour.

Utilisez **Effacer les notes terminées** pour vérifier et supprimer les notes terminées. Un retrait connu et tout dépôt associé enregistré doivent être finalisés ; les notes non vérifiées restent enregistrées. Le RPC Ethereum sélectionné reçoit le hash du retrait et, le cas échéant, celui du dépôt associé : son fournisseur peut donc les relier. La vérification dépend des réponses de ce RPC.

La limite ne peut pas être abaissée sous le nombre de notes enregistrées. Une note indiquée comme dépensée peut ne pas avoir de retrait local enregistré ni de hash de transaction requis pour l’effacement ; elle reste alors enregistrée. Les notes sont vérifiées une par une : en cas d’interruption, des suppressions précédentes peuvent déjà être effectuées. Actualisez la liste après une erreur avant de réessayer.

## Confidentialité des comptes intelligents

Les modules et les exécutions des comptes intelligents sont publics sur la blockchain. Si une dapp demande d’installer un propriétaire ECDSA ou un module de récupération, vérifiez les adresses des propriétaires et les paramètres de récupération avant d’approuver.
