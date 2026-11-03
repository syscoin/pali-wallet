---
title: Privacidad y seguridad
---

Pali está diseñado para minimizar lo que las dapps pueden aprender sin una acción explícita del usuario.

## Qué no expone Pali

Pali no expone frases semilla, claves privadas, material privado passkey, contraseñas de billetera ni listas de cuentas sin restricciones a páginas web.

## Qué pueden solicitar las dapps

Las dapps pueden solicitar direcciones públicas de cuenta, estado del proveedor, estado de red, firmas, aprobaciones de transacciones, firma PSBT, aprobaciones de observación de activos, cambio de cadena, creación de cuentas passkey y ejecución por lotes.

## Seguridad de conexión

Conéctate solo a dapps en las que confíes. Una dapp conectada puede ver la cuenta que aprobaste para ese origen y puede solicitar acciones futuras. Puedes revocar el acceso del sitio desde la billetera.

## Datos públicos de blockchain

La actividad de blockchain es pública. Tu dirección, historial de transacciones, aprobaciones de tokens, actividad UTXO, despliegue de cuenta inteligente y actividad de cuenta inteligente passkey pueden ser visibles en exploradores e indexadores.

## Privacidad de passkey institucional

Si una dapp o institución proporciona una URL de sponsor, ese servicio puede recibir solicitudes de sponsor relacionadas con la ejecución de la cuenta. Revisa el texto de política institucional y la URL antes de aprobar.

## Notas privadas

Pali puede usar el servicio de privacidad predeterminado o tu propio servicio Sysnode. Para ejecutar tu propio servicio, consulta la [guía de Sysnode](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md).

El límite predeterminado es de 128 notas guardadas (hasta 4 MiB). En **Capacidad de notas** puedes elegir 256 (hasta 8 MiB) o 512 (hasta 16 MiB); los límites mayores pueden usar más almacenamiento local y ralentizar las operaciones del almacén. Cambiar el límite no elimina notas, pero las versiones antiguas de la billetera podrían no leer el formato actualizado.

Usa **Borrar notas completadas** para verificar y eliminar notas completadas. Un retiro conocido y cualquier depósito relacionado registrado deben estar finalizados; las notas no verificadas permanecen guardadas. El RPC de Ethereum seleccionado recibe el hash del retiro y, si existe, el del depósito relacionado, por lo que su proveedor puede vincularlos. La verificación depende de las respuestas de ese RPC.
