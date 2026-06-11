---
title: Comptes intelligents Pali
---

Les comptes intelligents Pali sont des comptes de contrat que Pali peut créer, connecter et utiliser pour l’utilisateur. Pour un utilisateur non technique, l’expérience ressemble à un compte de portefeuille : examiner la demande de la dapp, approuver avec un passkey ou une clé de portefeuille, puis Pali envoie la transaction. En dessous, le compte est modulaire : les validateurs autorisent les actions et les exécuteurs ajoutent des fonctions comme la récupération.

## Idée simple

- Una sola dirección mantiene los fondos y es la dirección que ven las dapps.
- La cuenta puede usar passkey, ECDSA o una política compuesta.
- Guardian recovery puede reemplazar el validador activo después de una demora.
- `wallet_sendCalls` puede ejecutar varios calls como una sola acción atómica.

## Modèle technique

`PaliSmartAccount` ejecuta calls y valida firmas mediante módulos estilo ERC-7579. `PaliSmartAccountFactory` deriva direcciones deterministas y despliega cuentas. Pali prepara las ejecuciones con codificación estilo ERC-4337 y usa EIP-1271 para firmas de contrato.

La cuenta se despliega primero con un validador ECDSA controlado por la wallet. Si la dapp pidió passkey u otro validador soportado, Pali instala el validador solicitado y elimina el bootstrap validator con una ejecución de la cuenta.

## Deux rôles : les validateurs signent, les gardiens récupèrent

ERC-7579 sépare les rôles des modules, et Pali s'appuie délibérément sur cette séparation :

- **Les validateurs** sont l'autorité de signature. Un validateur décide si une approbation donnée (preuve de passkey, signature ECDSA, résultat d'une politique composite) autorise une action du compte. Seuls les validateurs peuvent approuver des transactions.
- **Les exécuteurs** ajoutent au compte des comportements qui ne sont pas une signature. Le module de récupération par gardiens de Pali est un exécuteur : les gardiens ne peuvent ni signer ni déplacer des fonds, ils peuvent seulement programmer un remplacement du validateur actif soumis à un délai.

Garder ces rôles séparés est ce qui rend la récupération sûre à recommander. La compromission d'un gardien ne donne pas à un attaquant le pouvoir de signer — elle lui donne une tentative de récupération retardée, visible et annulable.

## Politiques de signature composites

Le validateur composite combine des validateurs enfants sous un seuil, ce qui transforme un compte en moteur de politiques :

- **1-of-N** — n'importe lequel de plusieurs authentificateurs peut approuver. Pratique pour les comptes personnels avec un passkey sur chaque appareil.
- **t-of-N** — un quorum doit approuver. La forme naturelle pour les trésoreries partagées, les desks et les comptes contrôlés par une équipe.
- **N-of-N** — chaque validateur configuré doit approuver. Pour les comptes à assurance maximale.

Les composites peuvent s'imbriquer : un enfant d'un composite peut lui-même être un composite, donc des politiques hiérarchiques — par exemple « la clé du CFO ET (2 quelconques des 3 passkeys du desk) » — sont exprimables sans contrats personnalisés. La récupération par gardiens reste indépendante de la politique de validateurs active.

## Agilité des validateurs et préparation post-quantique

Parce que l'autorisation vit dans des modules remplaçables, le compte n'est marié à aucun schéma de signature. Aujourd'hui, Pali fournit ECDSA (le validateur par défaut détenu par le portefeuille), les passkeys P-256 WebAuthn et le validateur composite. Quand de nouveaux types de validateurs seront déployés — y compris des schémas de signature post-quantiques — ils s'installeront sur le même compte à la même adresse. À ce stade, l'autorisation de chaque transaction peut fonctionner sans aucun ECDSA dans la boucle. Les fonds, l'historique et les intégrations ne bougent jamais ; seule l'autorité de signature évolue.

## Pour les institutions et les équipes

Las instituciones deberían tratar estas cuentas como infraestructura de cuenta, no solo como login con passkey. Usen passkeys para onboarding más sencillo, ECDSA o validadores compuestos para controles de equipo o hardware wallet, guardian recovery para reemplazo con demora, y cuentas de gas financiadas para despliegue y ejecución. Documenten quién controla cada validador, quiénes son los guardianes y qué significa la demora de recuperación.

Pali muestra una advertencia especial si una dapp solicita owners ECDSA externos, porque esas direcciones pueden aprobar acciones futuras de la cuenta.

## Méthode dapp

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```

Si no se pasa `authenticator`, Pali usa passkey por defecto.

## Réseaux pris en charge

Les comptes intelligents Pali fonctionnent sur les chaînes EVM compatibles où la factory et les modules Pali existent aux adresses attendues par Pali. Ce n'est pas limité aux chaînes opérées par Pali : si la chaîne active expose le déployeur CREATE2 canonique, Pali peut déployer la configuration de compte intelligent manquante directement depuis le portefeuille. Ouvrez Pali Settings, allez dans Advanced, puis utilisez le bouton Deploy dans **Smart account setup**.

Les validateurs passkey ont besoin de la vérification P-256 WebAuthn. Beaucoup d'environnements EVM modernes l'exposent via un precompile P-256/passkey, mais les intégrateurs doivent vérifier le support de la chaîne avant de dépendre des validateurs passkey.
