---
title: Cuentas inteligentes y validadores
---

Las cuentas inteligentes de Pali son cuentas de contrato EVM que pueden estar controladas por módulos. Una passkey es una de las formas admitidas de controlar una cuenta inteligente. En lugar de firmar cada acción con la clave privada de una EOA normal, el usuario puede aprobar acciones mediante la interfaz de passkeys del navegador o del sistema operativo.

Las passkeys WebAuthn usan firmas P-256 internamente. El validador de passkeys de Pali está diseñado para que la cuenta inteligente pueda verificar esas pruebas P-256. Por eso una aprobación biométrica o mediante una passkey de plataforma puede autorizar una acción on-chain sin exponer la clave privada de la passkey a Pali ni a la dapp.

## ¿Por qué usar una cuenta inteligente?

- Métodos de aprobación modulares para el uso diario.
- Control ECDSA de la billetera cuando una clave de billetera normal deba ser propietaria de la cuenta.
- Políticas de gestión compartida mediante validadores compuestos.
- Ejecución por lotes con una sola aprobación del usuario.
- Recuperación mediante guardianes tras un bloqueo temporal.
- Creación determinista que permite a Pali reconstruir los registros de las cuentas.

## Passkeys, ECDSA y cuentas de gestión compartida

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pantalla de ajustes de Pali para crear una cuenta inteligente" />
</a>
  <figcaption>Los usuarios pueden crear cuentas inteligentes modulares desde Ajustes o solicitudes de dapps y elegir el validador que controla las aprobaciones.</figcaption>
</figure>

Pali admite estos estilos de validadores:

- **Passkey:** el navegador o el sistema operativo solicita una aprobación WebAuthn.
- **ECDSA:** las direcciones EVM de propietarios configuradas aprueban las acciones de la cuenta.
- **SLH-DSA:** el firmante poscuántico local de Pali aprueba las acciones mediante su estado de firma cifrado. Consulta [Firmante poscuántico](./post-quantum-signer) para conocer las limitaciones de las copias de seguridad y del contador de firmas.
- **Compuesto:** se combinan validadores secundarios bajo un umbral, por ejemplo, passkey o ECDSA.

Piensa en los validadores como la respuesta a «¿quién puede aprobar acciones de esta cuenta?». Lo útil es que la respuesta puede cambiar sin cambiar tu cuenta:

- **Una aprobación** (1-of-N): debe aprobar un validador secundario configurado.
- **Un umbral de aprobaciones** (t-of-N): debe aprobar al menos el número configurado de validadores secundarios.
- **Todas las aprobaciones** (N-of-N): deben aprobar todos los validadores secundarios configurados.

Pali recopila las aprobaciones de los validadores secundarios integrados disponibles localmente, en el orden configurado en la política, hasta alcanzar el umbral. Rechazar una aprobación detiene la solicitud; Pali no cambia silenciosamente a otro firmante tras un rechazo. La política debe conservar suficientes validadores secundarios integrados que puedan firmar localmente para alcanzar su umbral. Los validadores personalizados compatibles pueden ser secundarios opcionales, pero Pali no recopila para ellos firmas externas o personalizadas ni aprobaciones entre dispositivos. Esta versión no admite políticas compuestas anidadas.

El constructor de políticas compuestas requiere al menos dos validadores instalados. El flujo guiado para cambiar el método de aprobación sustituye al validador anterior. El flujo avanzado actual **Validador personalizado** permite conservar validadores compatibles adicionales, pero requiere los datos de inicialización correctos del módulo; no es una configuración sencilla de aprobaciones entre dispositivos.

Cambiar el validador no cambia la dirección, los saldos ni el historial de la cuenta inteligente. El acceso a un firmante local sigue dependiendo de que su clave o passkey esté disponible; cambiar la política no restaura el estado de firma perdido ni coordina el uso de SLH-DSA entre dispositivos restaurados.

Los guardianes intencionalmente **no** forman parte de esta lista. Un guardián nunca puede aprobar una transacción; su único poder es iniciar una recuperación lenta y visible si pierdes el acceso. Esa separación te protege ante la pérdida de acceso sin darle a nadie el control cotidiano.

Pali puede usar un perfil de passkey compartido de la billetera o crear una credencial de passkey independiente para una cuenta. Las passkeys compartidas son prácticas para quienes quieren una sola passkey controlada por la billetera. Las passkeys independientes pueden ayudar a aislar las credenciales por servicio o política.

## Despliegue

Una cuenta inteligente puede existir como dirección contrafactual mientras Pali prepara su creación. Pali deriva la dirección a partir de entradas deterministas de la fábrica, despliega mediante la fábrica de Pali y guarda localmente metadatos duraderos de la cuenta.

La cuenta comienza con un validador inicial controlado por la billetera para realizar un despliegue determinista. Si el usuario o la dapp seleccionó una passkey u otro validador, Pali instala ese validador y elimina el inicial mediante una ejecución de la cuenta inteligente.

## Redes compatibles

Las cuentas inteligentes requieren que la fábrica de Pali y los contratos de módulos existan en las direcciones que Pali usa para la cadena activa. En esta versión de Pali, la red de pruebas `zkTanenbaum` está configurada para crear cuentas inteligentes, y el soporte de producción de zkSYS usa el mismo modelo una vez configuradas las direcciones de la fábrica y los módulos de producción.

Otras cadenas EVM compatibles pueden usar los mismos contratos. Cuando la red activa dispone de soporte canónico de CREATE2, Pali puede desplegar la infraestructura que falta para las cuentas inteligentes desde la propia billetera: abre Ajustes, ve a Avanzado y usa el botón de despliegue de **Configuración de cuenta inteligente**. Los validadores de passkeys necesitan soporte para verificar P-256 WebAuthn, que muchos entornos EVM modernos ofrecen mediante un precompilado de P-256/passkey.

### Configuración pendiente

Una configuración lenta muestra la acción **Consultar estado**. Salir de la página o cambiar de red no cancela una transacción que ya se haya enviado. Vuelve a la red original y consulta su estado de configuración antes de intentar otro despliegue. Un tiempo de espera agotado o una respuesta ausente no demuestran que no se haya desplegado nada.

## Recuperación

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pantalla de ajustes de políticas de cuentas inteligentes de Pali" />
</a>
  <figcaption>La pantalla de políticas de la cuenta inteligente muestra los módulos instalados, los detalles del validador activo, la recuperación mediante guardianes y la gestión de módulos.</figcaption>
</figure>

Si se eliminan los datos locales de la billetera o se instala Pali en un dispositivo nuevo, las cuentas inteligentes deterministas de Pali se pueden reconstruir a partir de los metadatos de la billetera y la configuración de la cadena. Las cuentas con validadores de passkey siguen necesitando acceso a la credencial de passkey correspondiente para aprobar acciones.

Una credencial de passkey puede controlar varias cuentas inteligentes. Pali separa el perfil de la credencial de passkey de los metadatos de cada cuenta inteligente desplegada.

## Recuperación mediante guardianes

Pali usa guardianes de recuperación bajo autocustodia para recuperar cuentas inteligentes. Un guardián es una dirección EVM que el usuario controla por separado del validador activo; normalmente es una billetera EVM de respaldo, una cuenta importada o una billetera hardware, pero on-chain puede ser **cualquier cuenta capaz de demostrar una firma**, incluida una cuenta de contrato. Mientras la cuenta funciona normalmente, el usuario puede añadir o eliminar guardianes y actualizar el período de espera desde la pantalla de políticas.

El módulo de recuperación verifica las aprobaciones de los guardianes mediante comprobaciones estándar de firmas: una firma ECDSA normal para direcciones ordinarias, o una comprobación de firma de contrato ERC-1271 cuando la dirección del guardián es un contrato. Por tanto, un guardián puede ser otra cuenta inteligente, incluso una cuya política de firma sea un validador compuesto, personalizado o futuro poscuántico. La ruta de recuperación hereda el esquema de firma que impone la cuenta del guardián, por lo que su seguridad no se limita a claves ECDSA clásicas.

Las pantallas de guardianes de Pali pueden recopilar aprobaciones de guardianes locales basados en claves (cuentas de la billetera, importadas o hardware) y de cuentas inteligentes locales para las que Pali pueda firmar, incluidas las cuentas SLH-DSA. Un guardián de cuenta inteligente debe estar ya desplegado on-chain para responder a las comprobaciones de firma ERC-1271. Un guardián externo que no esté disponible como cuenta de firma local en Pali sigue necesitando un flujo externo de recuperación para generar su aprobación.

La recuperación mediante guardianes no es instantánea. Iniciarla crea un objetivo de recuperación de reemplazo, solicita al guardián configurado que firme la intención de recuperación y envía una solicitud con bloqueo temporal. Una vez transcurrido el período de espera, cualquiera puede finalizar la transacción de recuperación. El usuario puede entonces operar la cuenta con el validador de reemplazo.

La firma del guardián vincula la cadena, la dirección de la cuenta, el módulo de recuperación, la sal de recuperación, el modo de ejecución y los datos de llamada de recuperación. Pali usa una sal nueva en cada intento y el módulo permite solo una recuperación activa por cuenta.

Nota técnica: el ejecutor de recuperación mediante guardianes almacena por cuenta un conjunto de guardianes, un umbral, un retraso, una caducidad y una recuperación pendiente. Pali presenta actualmente flujos sencillos de guardianes para facilitar su uso, mientras que el módulo admite políticas de umbral como 1-of-N o M-of-N.

## Cuentas creadas desde dapps

Las dapps pueden solicitar una cuenta inteligente con `wallet_prepareSmartAccount`:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "p256-webauthn"
  }
}
```

Las dapps también pueden solicitar un validador ECDSA:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "ecdsa",
    "config": {
      "owners": ["0x..."],
      "threshold": 1
    }
  }
}
```

Si el propietario ECDSA solicitado no es una cuenta local de Pali, Pali muestra una advertencia y exige una confirmación explícita antes de continuar.

## Referencias de estándares

Las cuentas inteligentes de Pali se basan en estándares públicos de cuentas inteligentes:

- [Abstracción de cuentas ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) para la ejecución de cuentas mediante UserOperation.
- [Cuentas inteligentes modulares ERC-7579](https://eips.ethereum.org/EIPS/eip-7579) para módulos de validación y ejecución.
- [Validación de firmas de contrato ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) para firmas de cuentas de contrato.
- [WebAuthn Nivel 3](https://www.w3.org/TR/webauthn-3/) para aprobaciones con passkeys.
