---
title: Privacidad y seguridad
---

Pali está diseñado para minimizar lo que las dapps pueden aprender sin una acción explícita del usuario.

## Qué no expone Pali

Pali no expone frases semilla, claves privadas, material privado passkey, contraseñas de billetera ni listas de cuentas sin restricciones a páginas web.

## Qué pueden solicitar las dapps

Las dapps pueden solicitar direcciones públicas de cuenta, estado del proveedor, estado de red, firmas, aprobaciones de transacciones, firma PSBT, aprobaciones de observación de activos, cambio de cadena, creación de cuentas inteligentes y ejecución por lotes.

## Seguridad de conexión

Conéctate solo a dapps en las que confíes. Una dapp conectada puede ver la cuenta que aprobaste para ese origen y puede solicitar acciones futuras. Puedes revocar el acceso del sitio desde la billetera.

## Datos públicos de blockchain

La actividad de blockchain es pública. Tu dirección, historial de transacciones, aprobaciones de tokens, actividad UTXO, despliegue de cuenta inteligente y actividad de cuenta inteligente pueden ser visibles en exploradores e indexadores.

## Proveedores de servicios de red

Los proveedores RPC y Blockbook seleccionados reciben las direcciones de cuenta y las consultas o difusiones de transacciones necesarias para tus acciones. Las consultas de cuentas UTXO pueden incluir una clave pública extendida (xpub). Los servicios de descubrimiento de tokens, exploradores, precios, descubrimiento de redes y asistencia de hardware reciben solicitudes según la operación. Estos servicios también pueden ver tu dirección IP y el momento de las solicitudes. Las dapps conectadas reciben las cuentas públicas que apruebas y las firmas que autorizas.

## Notas privadas

Esta función usa cuatro pools fijos de ETH de Tornado Classic (0,1, 1, 10 y 100 ETH) en la red principal de Ethereum; no hace privada la actividad normal de la billetera. Para depositar o retirar directamente se necesita una cuenta HD de software o importada capaz de firmar. Una cuenta importada de solo observación puede aportar el contexto para un retiro mediante relayer; las cuentas de hardware y las cuentas inteligentes no son compatibles con estas operaciones. Un retiro directo vincula públicamente al pagador del gas con el destinatario. Un relayer tiene sus propias comisiones y riesgos de confianza. No se garantiza anonimato ni privacidad poscuántica.

Una nota privada es un secreto al portador: quien la tenga puede retirar. Mientras la billetera esté desbloqueada y conozcas su contraseña, usa **Mostrar para respaldo** en cada nota guardada y conserva los respaldos en secreto y de forma segura. La frase de recuperación por sí sola no restaura las notas generadas después de recuperar, restablecer o cambiar de instalación.

El servicio de privacidad proporciona datos públicos de los pools y el directorio de relayers; el RPC de Ethereum seleccionado y el extremo del relayer elegido son independientes. El servicio predeterminado es `https://sysnode.info`. La configuración acepta un origen HTTPS o HTTP en `localhost` o `127.0.0.1`, sin ruta, credenciales, consulta ni fragmento. Cambiar de servicio borra los datos públicos preparados y exige preparar el pool de nuevo; las notas guardadas permanecen. Los proveedores pueden observar tu IP y los momentos de las solicitudes.

Pali puede usar el servicio de privacidad predeterminado o tu propio servicio Sysnode. Para ejecutar tu propio servicio, consulta la [guía de Sysnode](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md).

El límite predeterminado es de 128 notas guardadas (hasta 4 MiB). En **Capacidad de notas** puedes elegir 256 (hasta 8 MiB) o 512 (hasta 16 MiB); los límites mayores pueden usar más almacenamiento local y ralentizar las operaciones del almacén. Cambiar el límite no elimina notas, pero las versiones antiguas de la billetera podrían no leer el formato actualizado.

Usa **Borrar notas completadas** para verificar y eliminar notas completadas. Un retiro conocido y cualquier depósito relacionado registrado deben estar finalizados; las notas no verificadas permanecen guardadas. El RPC de Ethereum seleccionado recibe el hash del retiro y, si existe, el del depósito relacionado, por lo que su proveedor puede vincularlos. La verificación depende de las respuestas de ese RPC.

No puedes reducir el límite por debajo del número de notas guardadas. Una nota marcada como gastada puede carecer del registro local del retiro y del hash necesarios para borrarla; en ese caso permanece guardada. La verificación se hace nota por nota; si se interrumpe, algunas eliminaciones anteriores podrían haberse completado. Actualiza la lista después de un error antes de reintentar.

## Privacidad de las cuentas inteligentes

Los módulos y las ejecuciones de las cuentas inteligentes son públicos en la cadena. Si una dapp solicita instalar un propietario ECDSA o un módulo de recuperación, revisa las direcciones de los propietarios y la configuración de recuperación antes de aprobar.
