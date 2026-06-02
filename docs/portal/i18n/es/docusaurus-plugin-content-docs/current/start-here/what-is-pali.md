---
title: ¿Qué es Pali?
---

Pali Wallet es la extensión de billetera oficial de Syscoin y una billetera web3 de propósito general para cadenas compatibles con EVM. Está diseñada para tres audiencias superpuestas:

- **Usuarios regulares** que quieren una billetera de navegador segura para EVM, Syscoin, Rollux y activos UTXO.
- **Desarrolladores de dapps** que quieren acceso EVM compatible con MetaMask y acceso UTXO desde la misma extensión.
- **Instituciones** que quieren cuentas inteligentes passkey, recuperación de cuentas, política de sponsor y onboarding impulsado por dapps.

## Qué hace diferente a Pali

La mayoría de las billeteras de navegador exponen solo un proveedor EVM. Pali expone dos superficies complementarias:

- `window.ethereum` para dapps EVM, intencionalmente compatible con los flujos comunes de MetaMask.
- `window.pali` para flujos Syscoin UTXO y de estilo Bitcoin.

Esto permite que una dapp construya experiencias que atraviesan cadenas basadas en cuentas y basadas en UTXO sin pedir a los usuarios que instalen billeteras diferentes.

## Compatibilidad de un vistazo

| Capacidad | Superficie admitida |
| --- | --- |
| Solicitudes de proveedor EIP-1193 | `window.ethereum` |
| Descubrimiento de billetera EIP-6963 | anuncio de proveedor `window.ethereum` |
| Permisos de cuenta | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Transacciones y firmas EVM | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, métodos de firma relacionados |
| Solicitudes por lotes EIP-5792 | `wallet_sendCalls`, `wallet_getCapabilities` |
| Estado de cuenta UTXO y xpub | `window.pali` y métodos `sys_*` |
| Firma y transmisión PSBT | `sys_sign`, `sys_signAndSend` |
| Creación de cuenta inteligente passkey | `wallet_createPasskeyAccount` |

## Alcance actual de passkey

Las cuentas inteligentes passkey están disponibles solo en redes EVM de la familia zkSYS donde Pali ha configurado los contratos de fábrica passkey y la cadena admite verificación de pruebas P-256 WebAuthn. Esta compilación de Pali configura la testnet `zkTanenbaum` (`57057`). El soporte de producción zkSYS usa la misma arquitectura una vez que la dirección de fábrica de producción esté configurada en Pali. Las dapps deben comprobar capacidades y manejar limpiamente las cadenas no admitidas.
