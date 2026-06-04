---
title: Sécurité et opérations
---

Les intégrations institutionnelles passkey doivent être conçues comme une infrastructure de compte de production, pas seulement comme un bouton de connexion.

## Dépendance au réseau et au vérificateur

Les comptes passkey dépendent de la prise en charge zkSYS pour vérifier les signatures P-256 WebAuthn. Ne supposez pas qu'un compte passkey peut être créé sur n'importe quelle chaîne EVM simplement parce que la chaîne prend en charge les smart contracts. La chaîne doit avoir la factory passkey déployée et Pali doit avoir cette adresse de factory configurée pour la chaîne active.

Aujourd'hui, le déploiement de test configuré dans Pali est `zkTanenbaum` (`57057`). Traitez zkSYS production comme la cible de déploiement de production pour la même architecture une fois que sa factory est configurée dans le portefeuille.

## Checklist opérationnelle

- Décidez si chaque utilisateur reçoit un compte passkey Pali partagé ou un credential séparé.
- Décidez si le sponsoring est désactivé, gas-only ou requis.
- Maintenez la disponibilité du service de sponsor lorsque le mode `required` dépend d'une URL de sponsor distante, et documentez toute politique de repli avec signataire local.
- Surveillez les échecs de relayer, les deadlines expirées et les clés d'idempotence répétées.
- Fournissez un chemin de support utilisateur pour les appareils perdus et les récupérations échouées.
- Documentez si l'institution peut coautoriser l'exécution.

## Financement et déploiement

Les comptes intelligents passkey peuvent être contrefactuels avant la première utilisation. La première exécution peut nécessiter un payeur du gaz de déploiement ou un chemin de sponsor. Votre flux d'intégration doit expliquer si les utilisateurs doivent financer le compte avant de l'utiliser.

La factory peut calculer l'adresse du compte avant le déploiement. C'est utile pour l'intégration, car une dapp ou une institution peut afficher ou financer l'adresse avant la première transaction on-chain.

## Hypothèses de récupération

La récupération est limitée au portefeuille et à la passkey. Un utilisateur a généralement besoin de :

- le contexte de portefeuille Pali restauré
- le credential WebAuthn concerné
- la prise en charge de la factory passkey par la chaîne
- les métadonnées d'URL du sponsor si le compte récupéré utilise un sponsoring requis et que Pali ne peut pas déduire l'URL

La récupération n'est pas une porte dérobée dépositaire. La chaîne fournit des métadonnées publiques découvrables et des listes de comptes, mais l'utilisateur a toujours besoin du contexte de récupération du portefeuille et du credential WebAuthn concerné pour prouver le contrôle.

## État de sauvegarde du credential

Pali peut exposer l'état de sauvegarde du credential WebAuthn lorsque le navigateur et l'authenticator l'exposent. Traitez cela comme un signal opérationnel, pas comme une règle de sécurité on-chain.

L'état de sauvegarde peut indiquer si un credential semble lié à l'appareil, éligible à la sauvegarde ou actuellement sauvegardé/synchronisé par le fournisseur de passkey de plateforme. Une passkey synchronisée peut améliorer la commodité et la récupération après perte d'appareil, car l'utilisateur peut restaurer le credential via son compte Apple, Google, Microsoft ou un autre compte de plateforme. Le compromis est que la frontière de sécurité effective inclut maintenant ce compte de plateforme, son processus de récupération et tous les appareils où la passkey est synchronisée.

| État du credential | Implication pour la politique institutionnelle | Expérience utilisateur | Frontière de risque |
| --- | --- | --- | --- |
| Sauvegardé ou synchronisé | Accepter lorsque la récupération de compte et la commodité d'intégration comptent plus que l'isolation stricte à l'appareil. | Meilleure expérience de remplacement d'appareil et multi-appareil. Souvent le comportement par défaut de la plateforme pour les passkeys grand public. | La confiance s'étend au compte de plateforme, au flux de récupération de la plateforme et aux appareils synchronisés. |
| Éligible à la sauvegarde | Décider si l'éligibilité seule est acceptable, car le credential peut devenir synchronisé plus tard. | Flexible, mais les utilisateurs peuvent ne pas comprendre si la synchronisation est active. | Exige des conseils utilisateur clairs et une revue périodique de l'état si la valeur du compte change. |
| Lié à l'appareil ou non sauvegardé | Préférer pour les comptes de grande valeur, de trésorerie, d'administration ou de style cold. | Plus de friction et une charge de support plus élevée si l'appareil est perdu. | Isolation plus forte vers un authenticator ou une clé matérielle spécifique. |
| Inconnu ou indisponible | Éviter pour les décisions de politique à haute assurance sauf si vous avez des contrôles d'authenticator hors bande. | L'utilisateur peut continuer, mais l'institution ne peut pas classifier le credential avec confiance. | Ambigu ; ne pas traiter comme preuve de sauvegarde cloud ni comme preuve d'isolation liée à l'appareil. |

Pour les comptes institutionnels à assurance plus élevée, décidez et documentez si les passkeys synchronisées sont acceptables. Les passkeys synchronisées restent sûres pour un usage courant de portefeuille et de dapp, car Pali et la dapp ne reçoivent jamais la clé privée passkey, WebAuthn reste lié à l'origine, et l'authenticator de la plateforme effectue toujours la vérification utilisateur. Elles ne sont simplement pas le bon choix par défaut pour du stockage à froid, des contrôles de trésorerie ou de grands soldes à long terme, sauf si l'institution accepte explicitement la frontière de récupération du compte de plateforme.

## Communication utilisateur

Utilisez un texte de politique clair. Une bonne politique explique :

- qui opère le service de sponsor
- quelles actions exigent une coautorisation
- si l'institution paie le gaz
- ce qui se passe si le service de sponsor est indisponible

## Ne vous fiez pas au texte de politique pour l'application

`policyText` est un champ de divulgation et de métadonnées du portefeuille. L'application se fait via la politique on-chain et la validation de preuve de sponsor.
