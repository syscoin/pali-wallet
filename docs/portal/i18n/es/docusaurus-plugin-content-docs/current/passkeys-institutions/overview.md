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

## Dos roles: los validadores firman, los guardianes recuperan

ERC-7579 separa los roles de los módulos, y Pali aprovecha deliberadamente esa separación:

- **Los validadores** comprueban firmas para las aprobaciones normales de la cuenta, como passkeys, ECDSA y políticas compuestas.
- **Los ejecutores** pueden ejecutar acciones mediante un módulo instalado. El módulo de guardianes de Pali exige el umbral configurado y un plazo de espera. El flujo guiado sustituye al validador activo; el módulo on-chain no se limita a esa acción de la interfaz.

Los guardianes tienen, por tanto, autoridad diferida sobre la cuenta. Un umbral comprometido pone en riesgo el control y los fondos. El propietario actual puede actuar durante la espera, pero debe confirmar la acción protectora antes de una ejecución maliciosa. Consulta [Recuperación con guardianes](../users/smart-account-validators).

## Políticas de firma composite

El validador composite combina validadores hijos bajo un threshold, lo que convierte una cuenta en un motor de políticas:

- **1-of-N** — cualquiera de varios autenticadores puede aprobar. Conveniente para cuentas personales con un passkey en cada dispositivo.
- **t-of-N** — debe aprobar un quórum. La forma natural para tesorerías compartidas, mesas de trading y cuentas controladas por equipos.
- **N-of-N** — todos los validadores configurados deben aprobar. Cuentas de máxima garantía.

Pali recopila actualmente aprobaciones de validadores hijos integrados disponibles localmente hasta alcanzar el umbral. Esta versión no admite compuestos anidados ni la recopilación de aprobaciones externas o entre dispositivos. La recuperación con guardianes sigue siendo independiente de la política del validador activo.

## Agilidad de validadores y preparación post-cuántica

En redes configuradas, Pali admite ECDSA controlado por la wallet, passkeys P-256 WebAuthn, SLH-DSA y validadores compuestos. Los módulos on-chain correspondientes deben estar desplegados y las claves o credenciales locales necesarias disponibles. Los módulos reemplazables permiten adoptar después otros esquemas de firma en la misma dirección. Cambiar el validador no mueve fondos, historial ni integraciones.

El módulo de guardianes verifica aprobaciones ECDSA de direcciones normales y ERC-1271 de cuentas de contrato. Pali puede usar guardianes locales basados en claves y cuentas inteligentes locales ya desplegadas para las que puede firmar, incluidas cuentas SLH-DSA. Un guardián externo no disponible como firmante local requiere un flujo de aprobación externo.

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

## Control del usuario

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>Tras la revisión en la wallet, el navegador o el sistema operativo gestiona la creación del passkey WebAuthn cuando el validador elegido se basa en passkey.</figcaption>
</figure>

El usuario ve el sitio solicitante, la etiqueta de la cuenta, el autenticador solicitado y cualquier dirección externa de owner ECDSA antes de aprobar. El navegador o el sistema operativo muestra el prompt WebAuthn cuando Pali necesita una nueva credencial passkey. Pali muestra el progreso de despliegue, instalación de módulos y confirmación antes de conectar la cuenta inteligente a la dapp.

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-dapp-onboarding-video.png" src="/video/smart-account-dapp-onboarding.mp4" title="Smart-account dapp onboarding flow"></video>
  <figcaption>Onboarding iniciado por la dapp: revisa la solicitud, confirma y la cuenta inteligente queda lista.</figcaption>
</figure>

## Referencias de estándares

- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-1271 contract signature validation](https://eips.ethereum.org/EIPS/eip-1271)
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
