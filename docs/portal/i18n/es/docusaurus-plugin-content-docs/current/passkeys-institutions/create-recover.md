---
title: Crear y recuperar cuentas inteligentes
---

`wallet_prepareSmartAccount` crea una cuenta inteligente de Pali para incorporar usuarios desde una dapp. Pali deriva la cuenta, la despliega mediante la fábrica configurada, instala el validador solicitado cuando es necesario, conecta la cuenta a la dapp solicitante y guarda metadatos duraderos de la cuenta en el estado local de la billetera.

El estado local de la billetera representa las cuentas inteligentes que Pali puede operar. Una cuenta inteligente puede estar controlada por un validador de passkey, un validador ECDSA, un validador compuesto o módulos de recuperación mediante guardianes instalados después de su creación.

## Estructura de la cuenta inteligente y la fábrica

El sistema de cuentas inteligentes consta de estas partes:

- **Fábrica:** calcula direcciones deterministas y despliega cuentas con los datos iniciales de los módulos.
- **Cuenta inteligente:** ejecuta llamadas, registra los módulos instalados y solicita a los validadores que aprueben las firmas.
- **Validadores:** autorizan acciones. Pali admite ECDSA, passkeys P-256 WebAuthn y validadores compuestos.
- **Ejecutores:** añaden funciones a la cuenta. Pali usa la recuperación mediante guardianes como módulo ejecutor.

Los parámetros de cuenta de la fábrica incluyen:

| Parámetro | Significado |
| --- | --- |
| `salt` | Sal de despliegue determinista que Pali deriva del ancla de la billetera, el índice de la cuenta, la cadena y la versión de la cuenta. |
| `initialValidator` | Módulo validador usado para el despliegue inicial. Pali usa un validador ECDSA controlado por la billetera para una configuración determinista. |
| `initData` | Datos codificados de inicialización del validador. |

Después del despliegue, Pali puede instalar el validador solicitado y eliminar el inicial en un solo lote de la cuenta inteligente. Por eso una dapp puede solicitar una cuenta controlada por passkey mientras Pali mantiene determinista la ruta del primer despliegue.

## Crear una cuenta controlada por passkey

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      authenticator: { id: 'p256-webauthn' },
    },
  ],
});
```

Si la dapp omite `authenticator`, Pali usa la ruta de passkey de forma predeterminada. Usa una solicitud que solo incluya el identificador, como `{ id: 'p256-webauthn' }`, y deja que Pali seleccione o cree la credencial controlada por la billetera. Los propietarios ECDSA externos siguen usando el flujo de confirmación explícita que se describe abajo.

## Crear una cuenta inteligente ECDSA

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Team account',
      authenticator: {
        id: 'ecdsa',
        config: {
          owners: ['0xOwnerAddress'],
          threshold: 1,
        },
      },
    },
  ],
});
```

Los propietarios ECDSA que ya son cuentas locales de la billetera Pali se consideran controlados por la billetera. Las direcciones de propietarios ECDSA externos solo se permiten tras una advertencia y una confirmación explícitas, porque esas direcciones pueden aprobar acciones futuras de la cuenta inteligente.

## Comportamiento de creación y despliegue

Cuando una dapp solicita una cuenta inteligente:

1. Pali verifica que la cadena activa tenga configurada la infraestructura de cuentas inteligentes de Pali.
2. Pali deriva el siguiente descriptor de cuenta determinista y su dirección contrafactual.
3. Pali crea o normaliza el autenticador solicitado.
4. Pali muestra el host de la dapp, la etiqueta de la cuenta, el tipo de autenticador y cualquier propietario ECDSA externo.
5. Pali crea la cuenta localmente y la despliega on-chain con el validador inicial.
6. Si el validador solicitado es distinto del inicial, Pali instala el solicitado y desinstala el inicial mediante una ejecución de la cuenta inteligente.
7. Pali espera la confirmación, guarda metadatos duraderos de la cuenta inteligente y conecta la cuenta a la dapp.

Si la dirección resultante ya está presente localmente, Pali puede reutilizar esa cuenta inteligente local.

## ¿Qué determina la dirección?

La dirección de la cuenta inteligente se deriva de la fábrica, la implementación de la cuenta, los datos de inicialización del validador inicial y la sal de despliegue determinista de Pali. Pali deriva la sal de un ancla de la billetera y del índice de la cuenta, por lo que las cuentas se pueden recuperar mediante los metadatos de la billetera y no mediante un estado local aleatorio.

## Si el usuario pierde los datos locales de Pali

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Pantalla de ajustes de Pali para recuperar cuentas inteligentes" />
</a>
  <figcaption>La pantalla de recuperación ayuda a restaurar el acceso a cuentas inteligentes reconstruyendo cuentas creadas por Pali o usando la recuperación mediante guardianes para reemplazar el validador activo.</figcaption>
</figure>

Si se pierde el perfil del navegador, el almacenamiento de la extensión o los metadatos locales de la cuenta inteligente, la recuperación depende de los módulos actuales de la cuenta:

- Las cuentas deterministas creadas por Pali se pueden reconstruir a partir del ancla de la billetera, la cadena, el índice de la cuenta y la configuración de la fábrica.
- Los validadores de passkey siguen necesitando la credencial WebAuthn correspondiente para autorizar acciones futuras.
- La recuperación mediante guardianes puede reemplazar el validador activo tras el retraso configurado si el método de aprobación original no está disponible.

La recuperación de Pali funciona bajo autocustodia. No es una puerta trasera del servidor y no puede eludir los módulos instalados de la cuenta.

## RP ID y nombre de la credencial

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Solicitud de aserción de passkey del navegador o sistema operativo" />
</a>
  <figcaption>La recuperación y la ejecución requieren una aserción WebAuthn de la credencial de passkey correspondiente.</figcaption>
</figure>

El navegador controla el RP ID efectivo de WebAuthn en el origen de la extensión, salvo que el flujo de la billetera proporcione uno. Pali etiqueta la credencial compartida predeterminada como `Pali Wallet Passkey` y usa la etiqueta de cuenta solicitada para mostrar al usuario la asociación con la cuenta.
