---
title: Primeros pasos para usuarios
---

Pali te permite administrar cuentas EVM, cuentas Syscoin UTXO y cuentas inteligentes modulares desde una sola extensión.

## Configuración básica

1. Instala la extensión Pali.
2. Crea una nueva billetera o importa una frase semilla existente.
3. Establece una contraseña fuerte.
4. Haz una copia de seguridad offline de tu frase semilla.
5. Elige la red que quieres usar.
6. Conéctate solo a dapps en las que confíes.

## Configuración y carga

Mantén abierta y visible la configuración mientras no haya terminado. Salir de ella, ocultarla o recargarla borra los datos sensibles introducidos y puede obligarte a empezar de nuevo. Conserva la frase semilla de la que hiciste una copia de seguridad.

Si Pali no puede confirmar que la creación de la billetera terminó, deja que se recargue y compruebe la billetera. Si aparece una pantalla de desbloqueo, usa la contraseña que acabas de establecer. No supongas que una respuesta interrumpida significa que no se creó ninguna billetera ni repitas inmediatamente la creación.

Durante una operación lenta, Pali puede mostrar opciones de recuperación y mantener disponible la navegación. Las acciones sensibles siguen esperando a que la cuenta y la red se estabilicen. Recibir oculta temporalmente la dirección, el código QR y el control para copiar; las solicitudes al faucet también esperan. Comprueba de nuevo la cuenta y la red antes de continuar.

## Conectarse a una dapp

Cuando un sitio solicita acceso, Pali abre un popup de conexión que muestra el sitio y te permite elegir la cuenta. Una dapp recibe solo la dirección de la cuenta conectada y el estado de proveedor aprobado.

Pali almacena conexiones por sitio. Puedes conectar distintos sitios a distintas cuentas, pero cada sitio tiene una sola cuenta activa a la vez.

## Cuentas EVM

Usa cuentas EVM para cadenas compatibles con Ethereum, Rollux, Syscoin NEVM y dapps que esperan comportamiento de billetera de estilo MetaMask.

Las dapps EVM pueden solicitar:

- acceso a cuentas
- transacciones
- firmas personales
- firmas de datos tipados
- solicitudes de observación de tokens
- solicitudes de agregar/cambiar cadena
- solicitudes de llamadas por lotes

## Cuentas UTXO

Usa cuentas UTXO para Syscoin UTXO y flujos de transacciones de estilo Bitcoin. Las dapps UTXO pueden solicitar estado con xpub, direcciones de cambio, firma PSBT y transmisión de transacciones.

## Cuentas inteligentes

Las cuentas inteligentes son cuentas de contrato controladas por módulos. Pali puede crear cuentas controladas por un validador de passkey, un validador ECDSA de la billetera o una política de gestión compartida. Son útiles para la incorporación a dapps, las acciones por lotes y la recuperación mediante guardianes. Algunas cuentas inteligentes son contrafactuales hasta su primera transacción de despliegue.
