---
title: Détection de jetons et API d’explorateurs
---

Pali peut utiliser l’API d’un explorateur pour trouver des jetons et des NFT que vous pouvez importer. Vous pouvez également ajouter un actif à partir de l’adresse de son contrat. Les soldes des jetons importés sont consultés via le RPC du réseau : la détection automatique est donc facultative.

## Ce qui fonctionne par défaut

| Réseau                    | Détection automatique                                                                                              | Si un actif manque                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Réseau principal Ethereum | Routescan, sans compte ni clé d’API. Prend en charge les jetons ERC-20 et les actifs ERC-721/ERC-1155 compatibles. | Utilisez **Importer un jeton → Ajouter Personnalisé**.                                                                              |
| Base                      | Aucune API de détection par défaut. Le réseau et son RPC restent disponibles.                                      | Ajoutez des actifs à partir de l’adresse de leur contrat ou configurez une API d’explorateur compatible à laquelle vous avez accès. |
| Arbitrum One              | Aucune API de détection par défaut. Le réseau et son RPC restent disponibles.                                      | Ajoutez des actifs à partir de l’adresse de leur contrat ou configurez une API d’explorateur compatible à laquelle vous avez accès. |
| Autres réseaux EVM        | Dépend de l’API d’explorateur configurée pour ce réseau.                                                           | Ajoutez des actifs à partir de l’adresse de leur contrat si la détection est indisponible.                                          |

Lorsqu’aucune API d’explorateur n’est configurée, Pali affiche directement le formulaire d’adresse du contrat, sans onglets, avec un bref message et un lien **Aide pour importer des tokens**. Effacer une URL d’API ne supprime ni le réseau ni ses actifs importés. Sans API d’explorateur, l’historique des transactions repose sur les transactions enregistrées localement et les consultations RPC ; il peut ne pas retrouver l’intégralité de l’historique antérieur.

## Ajouter manuellement un jeton ou un NFT

1. Sélectionnez le réseau et le compte appropriés.
2. Ouvrez **Importer un jeton**. Si des onglets sont affichés, choisissez **Ajouter Personnalisé**.
3. Saisissez l’adresse du contrat de l’actif sur ce réseau.
4. Vérifiez les informations détectées pour l’actif. Pour un actif ERC-1155, saisissez également son identifiant de jeton.
5. Importez l’actif.

Utilisez l’adresse du contrat publiée par le projet ou affichée dans un explorateur de confiance. Des contrats sans lien entre eux peuvent utiliser le même nom de jeton, et une adresse sur un réseau peut désigner un autre actif sur un autre réseau.

## Configurer une API d’explorateur

Une URL RPC, le site web d’un explorateur et une URL d’API d’explorateur ont des fonctions différentes. Le RPC connecte Pali au réseau ; le site web de l’explorateur ouvre les adresses et les transactions dans votre navigateur ; l’API de l’explorateur fournit les actifs détenus et l’historique indexés.

1. Ouvrez le sélecteur de réseaux de Pali et choisissez **Gérer les réseaux**.
2. Sélectionnez l’icône de crayon à côté du réseau EVM que vous souhaitez modifier.
3. Repérez **URL de l'API de l'Explorateur de Blocs (optionnel)**. Collez l’URL d’API appropriée parmi les exemples ci-dessous. Conservez votre URL RPC et votre identifiant de chaîne actuels, sauf si vous souhaitez également modifier ces paramètres.
4. Choisissez **Enregistrer**. Pali vérifie le RPC et l’accès de base à l’API de l’explorateur avant l’enregistrement. Une vérification d’accès réussie ne garantit pas la prise en charge de tous les points d’accès de détection ou d’historique.
5. Passez à un autre réseau, puis revenez au réseau que vous avez modifié. Cela actualise son paramètre d’API actif. Ouvrez à nouveau **Importer un jeton → Vos Tokens** pour charger les actifs détenus avec la nouvelle API.

Pour ajouter un nouveau réseau, choisissez **RPC personnalisé** dans le sélecteur de réseaux. Son formulaire comporte le même champ facultatif d’API d’explorateur. Pour désactiver la détection indexée sur un réseau, effacez ce champ et enregistrez.

## Formats pris en charge et exemples d’URL

### Ethereum : Routescan

L’URL d’API intégrée pour Ethereum est :

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api
```

Laissez-la sans clé pour utiliser l’accès public. Pali utilise les API d’actifs détenus de Routescan pour la détection et son API compatible avec Etherscan pour l’historique des transactions. L’indexation du fournisseur peut être incomplète ou retardée. Changer le numéro de chaîne dans cette URL ne confirme pas que Routescan prend en charge un autre réseau. Consultez la [référence de l’API Routescan](https://routescan.io/docs/api) pour connaître sa couverture et ses points d’accès.

Routescan indique actuellement une limite sans clé de **2 requêtes par seconde et 10 000 appels par jour**. Pali espace les requêtes et met les résultats en cache, mais les limites du fournisseur s’appliquent toujours. Consultez les [limites actuelles de Routescan](https://routescan.io/docs/plans-and-limits/rate-limits) et ses [offres](https://routescan.io/docs/plans-and-limits/api-keys-and-pricing).

Pour utiliser une clé d’API Routescan personnelle, remplacez `YOUR_API_KEY` dans :

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?apikey=YOUR_API_KEY
```

Pali envoie cette valeur dans l’[en-tête de requête `apikey`](https://routescan.io/docs/api/conventions) du fournisseur. Les limites de votre offre chez le fournisseur s’appliquent.

### Détection compatible avec Blockscout

Pali prend également en charge les API d’explorateurs qui implémentent le format de requête **account/tokenlist** de Blockscout. Configurez l’URL de base de l’API ainsi que tout sélecteur de chaîne ou toute clé d’API nécessaires ; Pali fournit l’adresse du compte et les paramètres de la requête de détection. Consultez la [documentation de la liste de jetons de Blockscout](https://docs.blockscout.com/devs/apis/rpc/account).

Par exemple, une API Blockscout que vous hébergez ou que votre fournisseur prend en charge peut utiliser :

```text
https://YOUR_BLOCKSCOUT_HOST/api
```

Si ce fournisseur exige une authentification par paramètres de requête :

```text
https://YOUR_BLOCKSCOUT_HOST/api?apikey=YOUR_API_KEY
```

L’hôte et la clé ci-dessus sont des valeurs à remplacer. Utilisez un service qui prend en charge le réseau sélectionné et autorise vos requêtes ; l’URL du site web d’un explorateur ne suffit pas.

Pour **Base**, Blockscout documente ce format d’API PRO :

```text
https://api.blockscout.com/v2/api?chain_id=8453&apikey=YOUR_API_KEY
```

L’API Base de Blockscout exige une clé autorisée et une offre payante. Obtenez la clé sur le [portail développeur de Blockscout](https://dev.blockscout.com), confirmez l’accès au réseau dans votre offre et remplacez `YOUR_API_KEY`. Le sélecteur est **`chain_id`**, avec un trait de soulignement. Cet exemple suit la [documentation officielle de l’API Base](https://docs.blockscout.com/base-api) ; il ne s’agit pas d’une alternative publique sans clé.

Pour **Arbitrum One**, le sélecteur de chaîne équivalent est `42161` :

```text
https://api.blockscout.com/v2/api?chain_id=42161&apikey=YOUR_API_KEY
```

Confirmez auprès de Blockscout l’accès à Arbitrum et la prise en charge des points d’accès avant d’utiliser cette configuration. L’URL suit son format multichaîne documenté ; sa disponibilité dépend de votre compte et de votre offre. Pali n’inclut pas de clé Blockscout partagée.

### Etherscan et Alchemy

Une URL d’API Etherscan V2 peut servir les requêtes d’historique des transactions prises en charge lorsque votre clé et votre offre les autorisent :

```text
https://api.etherscan.io/v2/api?chainid=1&apikey=YOUR_API_KEY
```

Utilisez l’identifiant de chaîne du réseau sélectionné et vérifiez les [exigences d’Etherscan concernant les points d’accès et les offres](https://docs.etherscan.io/api-reference/endpoint/txlist). **Un historique compatible avec Etherscan n’implique pas la détection automatique de jetons.** Pali n’implémente pas le [point d’accès PRO distinct d’Etherscan pour les actifs détenus en jetons](https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance) ; une clé Etherscan seule n’active pas **Vos Tokens**.

Les API de jetons d’Alchemy utilisent des requêtes et des réponses différentes, notamment [alchemy_getTokenBalances](https://www.alchemy.com/docs/data/token-api/token-api-endpoints/alchemy-get-token-balances). Pali ne possède pas d’adaptateur de détection de jetons pour Alchemy. Un point d’accès RPC Alchemy peut être utilisé dans le champ **URL RPC** s’il convient à votre réseau, mais il ne remplace pas le champ **URL de l'API de l'Explorateur de Blocs**.

## Clés d’API et confidentialité

Une clé d’API d’explorateur autorise l’accès à ce fournisseur et peut consommer votre quota d’utilisation. Elle est distincte de la clé privée ou de la phrase de récupération de votre portefeuille. Ne saisissez jamais une clé privée de portefeuille ou une phrase de récupération dans une URL d’API.

Pali enregistre l’URL d’API configurée dans les paramètres réseau de l’extension. Une clé incluse dans cette URL est visible par toute personne pouvant inspecter ces paramètres ou les requêtes de l’extension. Retirez les clés avant de partager des captures d’écran, des journaux ou des exemples de configuration. Les services d’explorateurs reçoivent également les adresses publiques des comptes que vous leur demandez de consulter. Voir [Confidentialité et sécurité](./privacy-and-safety).

## Résultats vides, API indisponibles et nouvelles tentatives

- **Aucun jeton supplémentaire à importer :** l’API n’a renvoyé aucun actif détenu supplémentaire pris en charge après exclusion des actifs déjà importés. Cela ne prouve pas que le compte ne possède aucun actif ; l’indexation et la couverture des actifs peuvent être incomplètes.
- **La détection n’est pas configurée :** le réseau n’a pas d’URL d’API d’explorateur. Ajoutez des actifs à partir de l’adresse de leur contrat ou configurez un service compatible via **Gérer les réseaux**.
- **API indisponible / accès interdit :** vérifiez le point d’accès du fournisseur, la chaîne sélectionnée, la clé d’API et l’offre. Une réponse `403` indique que le fournisseur a refusé l’accès.
- **Trop de requêtes :** une réponse `429` signifie que le fournisseur limite les requêtes. Son quota peut déjà être épuisé lorsque vous ouvrez la liste pour la première fois. Patientez avant d’utiliser **Réessayer** et vérifiez les limites d’utilisation du fournisseur si les échecs persistent.

Un échec de détection ne prouve pas que le solde d’un jeton est nul. Vous pouvez continuer à utiliser **Ajouter Personnalisé** et les consultations de solde via RPC lorsqu’un indexeur est indisponible.
