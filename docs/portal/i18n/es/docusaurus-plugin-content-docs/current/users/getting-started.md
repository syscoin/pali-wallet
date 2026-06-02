---
title: Primeros pasos para usuarios
---

Pali te permite administrar cuentas EVM, cuentas Syscoin UTXO y cuentas inteligentes passkey desde una sola extensión.

## Configuración básica

1. Instala la extensión Pali.
2. Crea una nueva billetera o importa una frase semilla existente.
3. Establece una contraseña fuerte.
4. Haz una copia de seguridad offline de tu frase semilla.
5. Elige la red que quieres usar.
6. Conéctate solo a dapps en las que confíes.

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

## Cuentas inteligentes passkey

Las cuentas passkey son cuentas inteligentes controladas por credenciales WebAuthn. Pueden ser útiles para onboarding administrado por instituciones, recuperación de cuentas y ejecución patrocinada. Algunas cuentas passkey son contrafactuales hasta su primera transacción de despliegue.
