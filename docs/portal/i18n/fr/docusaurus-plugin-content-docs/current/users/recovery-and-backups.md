---
title: Récupération et sauvegardes
---

Les sauvegardes sont importantes parce que Pali est non dépositaire. Le portefeuille ne peut pas récupérer pour vous une phrase de récupération, un mot de passe, une clé privée ou un secret d'authenticator passkey.

## Sauvegarde de la phrase de récupération

Notez la phrase de récupération de votre portefeuille et gardez-la hors ligne. Toute personne qui possède la phrase de récupération peut contrôler les comptes dérivés.

## État de sauvegarde des passkeys

Les passkeys peuvent être liées à un appareil ou synchronisées par le fournisseur de compte de la plateforme. Pali expose l'état lié à la sauvegarde lorsqu'il est disponible, mais le comportement exact dépend de l'authenticator, du navigateur et du système d'exploitation.

Vous pouvez voir un état indiquant si une passkey est liée à l'appareil, éligible à la sauvegarde ou sauvegardée/synchronisée. Une passkey synchronisée est généralement plus pratique parce qu'elle peut vous suivre via un compte de plateforme comme Apple, Google ou Microsoft. Une passkey liée à l'appareil ou une clé de sécurité matérielle peut être plus stricte, mais la perte de cet appareil peut rendre la récupération plus difficile.

| État que vous pouvez voir | Ce que cela signifie | Commodité | Compromis de sécurité | Bon cas d'usage |
| --- | --- | --- | --- | --- |
| Sauvegardée ou synchronisée | La passkey semble être stockée par un fournisseur de passkey de plateforme et peut se synchroniser vers d'autres appareils de confiance. | La plus élevée. Vous pouvez souvent récupérer après le remplacement d'un téléphone ou d'un ordinateur portable en vous reconnectant au compte de plateforme. | Le secret de la passkey reste protégé par le système de passkey de la plateforme, mais la frontière de sécurité inclut le compte de plateforme, le processus de récupération du compte et les appareils synchronisés. | Portefeuilles quotidiens, comptes de dapp, intégration institutionnelle et soldes plus faibles. |
| Éligible à la sauvegarde | L'authenticator indique que la passkey peut être sauvegardée ou synchronisée, mais elle peut ne pas être synchronisée actuellement. | Moyenne à élevée, selon que la synchronisation est activée ou non. | De futurs réglages de plateforme peuvent déplacer le credential vers une synchronisation cloud. Examinez les paramètres du fournisseur et de l'appareil si cela compte pour vous. | Utilisateurs qui veulent de la flexibilité de récupération tout en voulant vérifier si la synchronisation est active. |
| Liée à l'appareil ou non sauvegardée | La passkey semble liée à un seul authenticator ou appareil. | Plus faible. Si l'appareil est perdu et qu'aucun autre chemin de récupération n'existe, la récupération peut être plus difficile ou impossible. | Isolation plus forte, car le contrôle est concentré dans cet authenticator au lieu d'un compte synchronisé dans le cloud. | Soldes plus importants, comptes à sécurité plus élevée, clés de sécurité matérielles et usage de type cold wallet. |
| Inconnue ou indisponible | Le navigateur, l'OS ou l'authenticator n'a pas exposé assez d'informations de sauvegarde. | Inconnue. | Ne supposez ni récupération cloud ni isolation liée à l'appareil. Traitez-la comme ambiguë jusqu'à ce que vous vérifiiez la configuration de l'authenticator. | Usage temporaire, tests ou cas où vous pouvez vérifier indépendamment le fournisseur de passkey. |

Les passkeys synchronisées dans le cloud restent sûres pour un usage normal : la clé privée n'est pas remise à Pali ni à la dapp, WebAuthn reste lié à l'origine, et la vérification utilisateur est toujours effectuée par l'authenticator de la plateforme. Le compromis est que le compte de plateforme devient une partie du modèle de sécurité de votre portefeuille. Pour du stockage à froid, des fonds de trésorerie ou de grands soldes à long terme, privilégiez un authenticator lié à l'appareil ou une clé de sécurité matérielle, et ne gardez que de plus petits fonds opérationnels dans des comptes passkey synchronisés.

L'état de sauvegarde est un signal pour vous aider à choisir entre commodité et sécurité. Il ne remplace pas la sauvegarde de votre phrase de récupération, et il ne signifie pas que Pali ou une institution peut récupérer un secret passkey pour vous.

## Récupérer des comptes passkey

La récupération passkey de Pali utilise des métadonnées de récupération limitées au portefeuille et la découverte de comptes on-chain. Le flux de récupération :

1. Demande une assertion WebAuthn découvrable.
2. Recherche les comptes intelligents correspondants depuis le registre de factory et les journaux de création.
3. Ignore les comptes déjà présents dans le portefeuille.
4. Ajoute les comptes récupérables lorsque les métadonnées de sponsor peuvent être résolues.
5. Avertit si des métadonnées d'URL de sponsor sont nécessaires pour une politique de sponsor requise.

## Idempotence create/recover côté dapp

Lorsqu'une dapp appelle `wallet_prepareSmartAccount`, Pali vérifie d'abord si un compte passkey on-chain existant correspond à la politique de sponsor demandée. Si le compte correspondant existe déjà localement, Pali le réutilise au lieu de créer un doublon. S'il existe on-chain mais pas localement, Pali peut le récupérer dans le portefeuille.
