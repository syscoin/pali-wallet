---
title: Services de sponsor
---

Un service de sponsor est un endpoint contrôlé par une institution qui participe à la politique d'exécution d'un compte intelligent passkey.

## Objet sponsor

<figure>
  <a className="pali-media-link" href="/img/screens/sponsor-pending-success.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/sponsor-pending-success.png" alt="États en attente et succès du relais sponsor Pali" />
</a>
  <figcaption>L'exécution sponsorisée doit rendre les états en attente, succès et échec clairs pour les utilisateurs.</figcaption>
</figure>

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
| `url` | Endpoint de service que Pali contacte pour la prise en charge d'exécution par sponsor. |
| `signer` | Adresse de signataire sponsor attendue pour les preuves de politique requise. |
| `policyText` | Explication destinée à l'utilisateur, stockée dans les métadonnées du portefeuille. Pas une application on-chain. |

## Politique on-chain

La politique du compte intelligent stocke le mode, le signataire et le hachage d'URL. L'URL complète et le texte de politique sont des métadonnées du portefeuille utilisées pour l'affichage et les appels au service de sponsor.

## Idempotence

Les requêtes d'exécution sponsorisée utilisent une clé d'idempotence dérivée du hachage d'action passkey. Un service de sponsor doit traiter les requêtes répétées avec la même clé comme la même action.

## Mode sponsor requis

En mode `required`, la preuve de sponsor doit récupérer vers le signataire configuré. Si Pali ne peut pas obtenir ou valider la preuve de sponsor, l'exécution échoue.

## Mode gas-only

En mode `gasOnly`, le service de sponsor peut relayer ou aider à payer le gaz. Si le sponsoring est indisponible, Pali peut se rabattre sur une exécution avec le gaz du portefeuille lorsque la politique l'autorise.

## Conseils pour les institutions

- Utilisez des URLs de sponsor stables par utilisateur.
- Gardez les clés de signataire dans l'infrastructure institutionnelle, pas dans le frontend de la dapp.
- Rendez le texte de politique court, précis et compréhensible.
- Retournez un état cohérent pour les clés d'idempotence répétées.
- Surveillez les demandes de sponsor échouées et les deadlines d'exécution expirées.
