---
title: Cuentas passkey
---

Las cuentas passkey son cuentas inteligentes EVM controladas por credenciales WebAuthn. En lugar de firmar con una clave privada EOA normal, el usuario aprueba acciones con la UI de passkey del dispositivo o de la cuenta proporcionada por el navegador y el sistema operativo.

Detrás de escena, las passkeys WebAuthn usan firmas P-256. Las cuentas passkey zkSYS están construidas para que esas pruebas P-256 puedan ser verificadas por el sistema de cuenta inteligente/fábrica, que es la razón por la que una aprobación biométrica o de passkey de plataforma puede autorizar una acción on-chain.

## ¿Por qué usar una cuenta passkey?

- Onboarding institucional más sencillo.
- Soporte de políticas de cuenta inteligente.
- Servicios de sponsor opcionales para gas o coautorización.
- Ejecución por lotes con una sola aprobación del usuario.
- Recuperación desde datos de registro on-chain cuando faltan metadatos locales de la billetera.

## Passkeys compartidas y separadas

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-create.png" alt="Pantalla de ajustes de Pali para crear una cuenta passkey" />
</a>
  <figcaption>Los usuarios pueden crear cuentas passkey desde Settings y también desde solicitudes de dapps.</figcaption>
</figure>

Pali puede usar un perfil passkey compartido de billetera o crear una credencial passkey separada para una cuenta. Las passkeys compartidas son convenientes para usuarios que quieren una sola passkey controlada por la billetera. Las passkeys separadas pueden ayudar a las instituciones a aislar credenciales por servicio o política.

## Despliegue

Una cuenta inteligente passkey puede existir como dirección contrafactual antes de desplegarse on-chain. La primera ejecución puede desplegar la cuenta y realizar la acción solicitada en un solo flujo si la red y la ruta de financiación lo admiten.

Si la cuenta aún no está desplegada, asegúrate de que la cuenta passkey o el pagador de gas de despliegue tenga suficiente token nativo, o usa una ruta de sponsor institucional que admita el flujo de despliegue.

## Soporte de red

Las cuentas passkey requieren contratos de cuenta inteligente passkey zkSYS y soporte de verificación P-256. En esta compilación de Pali, la testnet `zkTanenbaum` está configurada para la creación de cuentas passkey. El soporte de producción zkSYS usa el mismo modelo una vez que la dirección de fábrica de producción esté configurada en la billetera.

## Recuperación

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-policy.png" alt="Pantalla de ajustes de política de cuenta passkey de Pali" />
</a>
  <figcaption>La pantalla de política passkey muestra modo de sponsor, firmante, URL y estado de respaldo donde esté disponible.</figcaption>
</figure>

Si se elimina el estado local de la billetera o Pali se instala en un dispositivo nuevo, Pali puede recuperar cuentas inteligentes passkey desde el registro de fábrica on-chain y los logs de eventos. Cualquier instalación de Pali con acceso a la misma credencial passkey puede descubrir las cuentas desplegadas coincidentes después de una assertion WebAuthn, omitir las cuentas que ya existen localmente e importar las cuentas seleccionadas.
