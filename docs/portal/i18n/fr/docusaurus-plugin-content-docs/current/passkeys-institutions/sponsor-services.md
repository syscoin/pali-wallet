---
title: Services de sponsor
---

Un service de sponsor est un endpoint contrôlé par une institution qui participe à la politique d'exécution d'un compte intelligent passkey.

## Objet sponsor


```js
{
  mode: 'required',
  url: 'https://institution.example/sponsor/user-123',
  signer: '0xSponsorSignerAddress',
  policyText: 'Institution co-authorization is required.'
}
```

## Signification des champs

| Champ | Objectif |
| --- | --- |
| `mode` | `disabled`, `gasOnly` ou `required`. |
| `url` | Endpoint de service facultatif que Pali contacte pour la prise en charge d'exécution par sponsor. Pali l'exige pour le sponsoring `gasOnly`, car il n'y a pas de sponsor de gaz distant sans URL de service. |
| `signer` | Adresse de signataire sponsor attendue pour les preuves de politique requise. Requise pour le mode `required`. |
| `policyText` | Explication destinée à l'utilisateur, stockée dans les métadonnées du portefeuille. Pas une application on-chain. |

## Politique on-chain

La politique du compte intelligent stocke le mode, le signataire et une URL de sponsor publique. Le texte de politique est une métadonnée du portefeuille utilisée pour l'affichage.

## Idempotence

Les requêtes d'exécution sponsorisée utilisent une clé d'idempotence dérivée du hachage d'action passkey. Un service de sponsor doit traiter les requêtes répétées avec la même clé comme la même action.

## Mode sponsor requis

En mode `required`, la preuve de sponsor doit récupérer vers le signataire configuré. L'URL de sponsor est facultative : Pali peut obtenir la preuve depuis le service de sponsor lorsqu'une URL est configurée, ou signer localement lorsque le signataire configuré est un compte disponible dans le portefeuille. Si Pali ne peut pas obtenir ou valider la preuve de sponsor, l'exécution échoue.

Le paiement du gaz est séparé de l'autorisation du sponsor. Une fois une preuve de sponsor valide disponible, Pali peut toujours payer le gaz depuis n'importe quel compte logiciel financé sélectionné pour l'exécution passkey.

## Mode gas-only

En mode `gasOnly`, le service de sponsor peut relayer ou aider à payer le gaz. Pali exige une URL de sponsor pour ce mode, car l'URL identifie le service de sponsoring du gaz. Si le sponsoring est indisponible, Pali peut se rabattre sur une exécution avec le gaz du portefeuille lorsque la politique l'autorise.

## Conseils pour les institutions

- Utilisez des URLs de sponsor stables par utilisateur.
- Gardez les clés de signataire dans l'infrastructure institutionnelle, pas dans le frontend de la dapp.
- Rendez le texte de politique court, précis et compréhensible.
- Retournez un état cohérent pour les clés d'idempotence répétées.
- Surveillez les demandes de sponsor échouées et les deadlines d'exécution expirées.
