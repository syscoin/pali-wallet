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
