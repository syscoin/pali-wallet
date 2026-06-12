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

- **Los validadores** son la autoridad de firma. Un validador decide si una aprobación dada (prueba de passkey, firma ECDSA, resultado de una política composite) autoriza una acción de la cuenta. Solo los validadores pueden aprobar transacciones.
- **Los ejecutores** agregan comportamiento de cuenta que no es una firma. El módulo de guardian recovery de Pali es un ejecutor: los guardianes no pueden firmar ni mover fondos, solo pueden programar un reemplazo con timelock del validador activo.

Mantener estos roles separados es lo que hace que la recuperación sea segura de recomendar. Comprometer a un guardián no le da a un atacante poder de firma — le da un intento de recuperación demorado, visible y cancelable.

## Políticas de firma composite

El validador composite combina validadores hijos bajo un threshold, lo que convierte una cuenta en un motor de políticas:

- **1-of-N** — cualquiera de varios autenticadores puede aprobar. Conveniente para cuentas personales con un passkey en cada dispositivo.
- **t-of-N** — debe aprobar un quórum. La forma natural para tesorerías compartidas, mesas de trading y cuentas controladas por equipos.
- **N-of-N** — todos los validadores configurados deben aprobar. Cuentas de máxima garantía.

Los composites pueden anidarse: un hijo de un composite puede ser a su vez un composite, de modo que las políticas jerárquicas — por ejemplo, "la clave del CFO Y (2 cualesquiera de 3 passkeys de la mesa)" — son expresables sin contratos personalizados. Guardian recovery permanece independiente de la política de validadores que esté activa.

## Agilidad de validadores y preparación post-cuántica

Como la autorización vive en módulos reemplazables, la cuenta no está casada con ningún esquema de firma. Hoy Pali incluye ECDSA (el predeterminado controlado por la wallet), passkeys P-256 WebAuthn y el validador composite. Cuando se desplieguen nuevos tipos de validador — incluidos esquemas de firma post-cuánticos — se instalarán en la misma cuenta con la misma dirección. En ese punto, la autorización por transacción puede ejecutarse sin ningún ECDSA involucrado. Los fondos, el historial y las integraciones nunca se mueven; solo evoluciona la autoridad de firma.

La misma agilidad se extiende a la recuperación. El módulo de guardian recovery verifica las aprobaciones con comprobación de firma estándar — ECDSA simple para direcciones normales, ERC-1271 para cuentas de contrato — de modo que un guardián puede ser a su vez una cuenta inteligente gobernada por un validador composite, personalizado o post-cuántico. Un guardián de cuenta de contrato desplegado hace que la ruta de recuperación herede el esquema de firma de esa cuenta; así, tanto la firma **como** la recuperación pueden llegar a funcionar sin ninguna dependencia de ECDSA clásico. La UX actual de guardianes de Pali recopila aprobaciones basadas en claves; los flujos para guardianes de cuenta de contrato pueden añadirse a la wallet más adelante porque el módulo on-chain ya los soporta.

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
