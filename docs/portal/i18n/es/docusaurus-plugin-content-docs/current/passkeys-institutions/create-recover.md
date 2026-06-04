---
title: Crear y recuperar cuentas passkey
---

`wallet_createPasskeyAccount` crea una nueva cuenta inteligente passkey para onboarding desde dapp. Pali crea o selecciona una credencial WebAuthn, despliega la cuenta inteligente on-chain, confirma los metadatos de recuperación desplegados y escribe la cuenta en el estado local de la billetera después de la confirmación.

El estado local de la billetera representa cuentas passkey desplegadas. La recuperación está disponible desde los ajustes de Pali para cuentas que ya existen on-chain.

## Estructura de cuenta inteligente y fábrica

El sistema passkey tiene dos piezas on-chain:

- **Fábrica:** crea cuentas, calcula direcciones contrafactuales, expone consultas de recuperación y puede desplegar y ejecutar la primera acción.
- **Cuenta inteligente:** almacena metadatos de recuperación, nonce, política de sponsor y valida pruebas de ejecución WebAuthn/P-256 antes de ejecutar llamadas.

Los parámetros de cuenta de fábrica incluyen:

| Parámetro | Significado |
| --- | --- |
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

## Comportamiento de creación y despliegue

Cuando una dapp solicita una cuenta passkey:

1. Pali verifica que la cadena activa admita cuentas inteligentes passkey.
2. Pali crea un salt de despliegue fresco para la nueva ruta de cuenta.
3. Pali obtiene o crea el perfil de credencial WebAuthn.
4. Pali calcula la dirección contrafactual y los metadatos de despliegue.
5. Pali solicita al usuario una assertion passkey sobre el hash de aprobación de despliegue.
6. Pali envía `createAccount`, o `createAccountAndExecute` cuando se necesita una acción inicial de política de sponsor, mediante el pagador de gas de despliegue configurado.
7. Pali espera la confirmación, lee los metadatos de recuperación de la cuenta inteligente desde la cadena y verifica que coincidan con la credencial preparada y los datos de origen.
8. Después de la confirmación, Pali crea la cuenta passkey local y la conecta a la dapp solicitante.

Si la dirección resultante ya está presente localmente como una cuenta passkey desplegada, Pali puede reutilizar esa cuenta local.

## ¿Qué determina la dirección?

La dirección de la cuenta inteligente se deriva de entradas de fábrica que incluyen coordenadas públicas passkey, hash de credencial, datos de origen, hash de RP ID y salt de despliegue. Cada nueva ruta de cuenta usa un salt de despliegue fresco, por lo que una credencial puede controlar varias cuentas inteligentes.

## Si el usuario pierde datos locales de Pali

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Pantalla de ajustes de Pali para recuperar cuentas inteligentes passkey" />
</a>
  <figcaption>La pantalla de recuperación descubre cuentas passkey on-chain que coinciden con la credencial del autenticador seleccionada.</figcaption>
</figure>

Si se pierden el perfil del navegador, el almacenamiento de la extensión o los metadatos locales de cuenta passkey, la cadena aún puede contener suficientes metadatos públicos para recuperar la cuenta:

1. Pali solicita una assertion WebAuthn descubrible desde el autenticador del usuario.
2. Pali consulta el registro de fábrica por hash de credencial.
3. Pali lee los metadatos de recuperación de cada cuenta candidata.
4. Pali omite cuentas ya presentes localmente.
5. Pali muestra las cuentas coincidentes con saldo e indicadores opcionales de actividad.
6. Pali importa las cuentas seleccionadas de vuelta al estado local de la billetera.

La recuperación desde Ajustes descubre cuentas desplegadas, omite cuentas ya presentes localmente y permite elegir qué cuentas coincidentes importar.

## RP ID y nombre de credencial

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Prompt de assertion passkey del navegador o sistema operativo" />
</a>
  <figcaption>La recuperación y la ejecución requieren una assertion WebAuthn de la credencial passkey relevante.</figcaption>
</figure>

El navegador controla el RP ID efectivo para WebAuthn de origen de extensión salvo que una ruta de billetera proporcione un RP ID. Pali etiqueta la credencial compartida predeterminada como `Pali Wallet Passkey` y usa el label de cuenta solicitado para la asociación de cuenta visible al usuario.
