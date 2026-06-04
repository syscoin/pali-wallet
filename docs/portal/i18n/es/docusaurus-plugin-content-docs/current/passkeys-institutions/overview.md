---
title: Passkeys e instituciones
---

Las cuentas inteligentes passkey de Pali permiten que una dapp solicite creación o recuperación de cuenta desde la billetera mientras el usuario controla la ejecución mediante WebAuthn.

Esto es útil para:

- onboarding institucional
- flujos de gas respaldados por sponsor
- políticas coautorizadas
- recuperación de cuenta después de reinstalar la billetera
- flujos atómicos de múltiples llamadas
- dapps que quieren UX passkey sin construir una billetera

## Por qué son posibles las passkeys zkSYS

Las passkeys usan WebAuthn, y el algoritmo de firma estándar de WebAuthn es ES256: ECDSA sobre la curva P-256, también conocida como secp256r1. Las billeteras EVM genéricas normalmente usan EOAs secp256k1, por lo que una firma passkey no es directamente una firma EOA.

Las cuentas passkey de Pali son cuentas inteligentes zkSYS diseñadas alrededor de la verificación P-256 on-chain. La billetera extrae las coordenadas de la clave pública WebAuthn, challenge, datos del autenticador, datos de cliente y firma P-256; luego la ruta de cuenta inteligente/fábrica verifica esa prueba contra los metadatos registrados de la cuenta. Eso es lo que hace utilizables la biometría del dispositivo o las passkeys de plataforma para autorización de cuenta mientras la clave privada permanece dentro del autenticador del usuario.

El resultado práctico es una UX de billetera que se siente como inicio de sesión biométrico, pero autoriza una acción de cadena:

1. La dapp solicita una cuenta inteligente passkey o ejecución por lotes.
2. Pali prepara un hash de acción para la cadena, cuenta, llamadas, nonce, deadline y política de sponsor exactos.
3. El navegador/OS pide al usuario aprobación passkey.
4. La cuenta inteligente zkSYS verifica la prueba P-256 WebAuthn on-chain antes de ejecutar.

## Redes admitidas

Las cuentas passkey no están habilitadas en todas las cadenas EVM. Requieren una fábrica passkey configurada y soporte de verificación P-256 de zkSYS.

| Red | Chain id | Estado en esta compilación de Pali |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | Configurada. Fábrica: `0xab188ceB49096A8B96E69E357FC99A8F90A57431`. |
| `zkSYS` | TBD en la configuración de la billetera | Objetivo de producción previsto para la misma arquitectura passkey una vez que la dirección de fábrica esté configurada en Pali. |

Si una dapp llama `wallet_createPasskeyAccount` en una red sin una fábrica configurada, Pali rechaza la solicitud en vez de crear metadatos no admitidos.

## Método de dapp

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-disabled.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-disabled.png" alt="Popup wallet_createPasskeyAccount de Pali con sponsorship deshabilitado" />
</a>
  <figcaption>El flujo passkey predeterminado impulsado por dapp debe comenzar con sponsorship deshabilitado a menos que la institución necesite explícitamente una política de sponsor.</figcaption>
</figure>

```js
const account = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: { mode: 'disabled' },
    },
  ],
});
```

El resultado incluye la `address` de la cuenta inteligente y metadatos públicos passkey.

## Modos de sponsor

| Modo | Significado |
| --- | --- |
| `disabled` | Sin política de sponsor. La billetera/usuario paga gas. |
| `gasOnly` | El servicio sponsor puede pagar gas. Pali requiere una URL de sponsor para este modo; si sponsorship falla, puede permitirse fallback a gas de la billetera. |
| `required` | La coautorización del sponsor es requerida por política. Se requiere un signer; la URL de sponsor es opcional cuando Pali puede obtener la prueba del signer desde una cuenta local en la billetera. |

## Control del usuario

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Hoja de creación de passkey del navegador o sistema operativo" />
</a>
  <figcaption>Después de la revisión de la billetera, el navegador o sistema operativo maneja la creación passkey WebAuthn.</figcaption>
</figure>

El usuario ve el sitio solicitante, label, modo de sponsor, firmante, URL y texto de política antes de aprobar. Luego el navegador u OS muestra el prompt passkey WebAuthn.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Passkey dapp onboarding flow"></video>
  <figcaption>Flujo de onboarding passkey: introducción con marca, solicitud de dapp y aprobación de cuenta en Pali.</figcaption>
</figure>
