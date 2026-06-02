---
title: Crear y recuperar cuentas passkey
---

`wallet_createPasskeyAccount` es intencionalmente idempotente para onboarding desde dapp. Pali comprueba cuentas on-chain recuperables antes de crear una nueva ruta de credencial/cuenta.

## Estructura de cuenta inteligente y fábrica

El sistema passkey tiene dos piezas on-chain:

- **Fábrica:** crea cuentas, calcula direcciones contrafactuales, expone consultas de recuperación y puede desplegar y ejecutar la primera acción.
- **Cuenta inteligente:** almacena metadatos de recuperación, nonce, política de sponsor y valida pruebas de ejecución WebAuthn/P-256 antes de ejecutar llamadas.

Los parámetros de cuenta de fábrica incluyen:

| Parámetro | Significado |
| --- | --- |
| `recoveryId` | Ancla de recuperación limitada a la billetera derivada del contexto de Pali Wallet, chain id y dirección de fábrica. |
| `passkeyX`, `passkeyY` | Coordenadas de clave pública P-256 extraídas de la credencial WebAuthn. |
| `credentialIdHash` | Hash del id de credencial WebAuthn. |
| `rpIdHash` | Hash de RP ID WebAuthn desde datos del autenticador. |
| `originHash`, `originLength` | Datos de vinculación al origen de la extensión desde datos de cliente WebAuthn. |
| `salt` | Salt de despliegue que permite que una credencial controle más de una cuenta inteligente. |

La cuenta inteligente expone ejecución, validación de firma, nonce, política de sponsor y lecturas de metadatos de recuperación. Pali usa esos metadatos para reconstruir cuentas después de pérdida de estado local.

## Crear con sponsorship deshabilitado

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: {
        mode: 'disabled',
      },
    },
  ],
});
```

## Crear con política de sponsor

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-required.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-required.png" alt="Popup de creación de cuenta passkey de Pali con detalles de política de sponsor requerida" />
</a>
  <figcaption>El sponsorship requerido muestra la URL del sponsor, firmante y texto de política antes de que el usuario apruebe.</figcaption>
</figure>

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Institution Managed Account',
      sponsor: {
        mode: 'required',
        url: 'https://institution.example/sponsor/user-123',
        signer: '0xSponsorSignerAddress',
        policyText:
          'This account requires institution co-authorization for execution.',
      },
    },
  ],
});
```

## Comportamiento de recuperar antes de crear

Cuando una dapp solicita una cuenta passkey:

1. Pali verifica que la cadena activa admita cuentas inteligentes passkey.
2. Pali comprueba si la passkey puede recuperar una cuenta on-chain que coincida con la política de sponsor solicitada.
3. Si la cuenta coincidente existe localmente, Pali la reutiliza.
4. Si la cuenta coincidente existe on-chain pero no localmente, Pali la importa.
5. Si existe una cuenta para el mismo hash de URL de sponsor pero el modo o firmante difiere, Pali rechaza con una incompatibilidad de recuperación.
6. Si no existe una cuenta coincidente, Pali procede con la creación de una nueva cuenta.

## ¿Qué determina la dirección?

La dirección de la cuenta inteligente se deriva de entradas de fábrica que incluyen coordenadas públicas passkey, hash de credencial, datos de origen, hash de RP ID, recovery ID y salt de despliegue. El texto de URL de sponsor no es por sí mismo la semilla de la dirección, pero la política de sponsor se usa por la lógica de coincidencia de recuperación para onboarding limitado a instituciones.

## Si el usuario pierde datos locales de Pali

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Pantalla de ajustes de Pali para recuperar cuentas inteligentes passkey" />
</a>
  <figcaption>La pantalla de recuperación descubre cuentas passkey on-chain que coinciden con la billetera restaurada y el autenticador.</figcaption>
</figure>

Si se pierden el perfil del navegador, el almacenamiento de la extensión o los metadatos locales de cuenta passkey, la cadena aún puede contener suficientes metadatos públicos para recuperar la cuenta:

1. El usuario restaura o abre Pali con el contexto de billetera que ancla el recovery ID.
2. Pali solicita una assertion WebAuthn descubrible desde el autenticador del usuario.
3. Pali consulta el registro de fábrica por recovery ID y hash de credencial.
4. Pali lee los metadatos de recuperación de cada cuenta candidata.
5. Pali omite cuentas ya presentes localmente.
6. Pali importa cuentas coincidentes de vuelta al estado local de la billetera.

Para crear/recuperar impulsado por dapp, Pali también compara el modo de sponsor, firmante y hash de URL de sponsor de la cuenta recuperada con la política de sponsor solicitada por la dapp. Esto impide que una institución vincule silenciosamente al usuario a una política de sponsor diferente de la solicitada por la dapp.

## RP ID y nombre de credencial

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Prompt de assertion passkey del navegador o sistema operativo" />
</a>
  <figcaption>La recuperación y la ejecución requieren una assertion WebAuthn de la credencial passkey relevante.</figcaption>
</figure>

El navegador controla el RP ID efectivo para WebAuthn de origen de extensión salvo que una ruta de billetera proporcione un RP ID. Pali etiqueta la credencial compartida predeterminada como `Pali Wallet Passkey` y usa el label de cuenta solicitado para la asociación de cuenta visible al usuario.
