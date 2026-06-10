---
title: Cuentas inteligentes de Pali
---

Las cuentas inteligentes de Pali son cuentas de contrato que Pali puede crear, conectar y operar por el usuario. Para una persona normal, la experiencia se parece a una cuenta de wallet: revisas la solicitud de la dapp, apruebas con passkey o una clave de wallet, y Pali envía la transacción. Por debajo, la cuenta es modular: los validadores autorizan acciones y los ejecutores agregan funciones como recuperación.

## Idea simple

- Una sola dirección mantiene los fondos y es la dirección que ven las dapps.
- La cuenta puede usar passkey, ECDSA o una política compuesta.
- Guardian recovery puede reemplazar el validador activo después de una demora.
- `wallet_sendCalls` puede ejecutar varios calls como una sola acción atómica.

## Modelo técnico

`PaliSmartAccount` ejecuta calls y valida firmas mediante módulos estilo ERC-7579. `PaliSmartAccountFactory` deriva direcciones deterministas y despliega cuentas. Pali prepara las ejecuciones con codificación estilo ERC-4337 y usa EIP-1271 para firmas de contrato.

La cuenta se despliega primero con un validador ECDSA controlado por la wallet. Si la dapp pidió passkey u otro validador soportado, Pali instala el validador solicitado y elimina el bootstrap validator con una ejecución de la cuenta.

## Para instituciones y equipos

Las instituciones deberían tratar estas cuentas como infraestructura de cuenta, no solo como login con passkey. Usen passkeys para onboarding más sencillo, ECDSA o validadores compuestos para controles de equipo o hardware wallet, guardian recovery para reemplazo con demora, y cuentas de gas financiadas para despliegue y ejecución. Documenten quién controla cada validador, quiénes son los guardianes y qué significa la demora de recuperación.

Pali muestra una advertencia especial si una dapp solicita owners ECDSA externos, porque esas direcciones pueden aprobar acciones futuras de la cuenta.

## Método de dapp

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```

Si no se pasa `authenticator`, Pali usa passkey por defecto.

## Redes soportadas

Las cuentas inteligentes de Pali funcionan en cadenas EVM compatibles donde la factory y los módulos de Pali existen en las direcciones que Pali espera. No está limitado a cadenas operadas por Pali: si la cadena activa expone el deployer CREATE2 canónico, Pali puede desplegar la configuración faltante de cuenta inteligente directamente desde la wallet. Abre Pali Settings, ve a Advanced y usa el botón Deploy en **Smart account setup**.

Los validadores passkey necesitan verificación P-256 WebAuthn. Muchos entornos EVM modernos la exponen mediante un precompile P-256/passkey, pero los integradores deberían verificar el soporte de la cadena antes de depender de validadores passkey.
