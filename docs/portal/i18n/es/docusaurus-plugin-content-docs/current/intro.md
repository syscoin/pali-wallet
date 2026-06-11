---
title: Bienvenido a Pali Wallet
slug: /
---

Pali Wallet es una billetera de extensión de navegador para personas y aplicaciones que necesitan acceso a blockchains basadas en cuentas y basadas en UTXO desde una sola capa de seguridad.

Para dapps EVM, Pali expone un proveedor `window.ethereum` compatible con MetaMask, con solicitudes EIP-1193, descubrimiento EIP-6963, permisos de cuenta, cambio de cadena, firmas, transacciones y llamadas por lotes. Para aplicaciones Syscoin UTXO y de estilo Bitcoin, Pali expone `window.pali` con métodos de cuenta, xpub, dirección de cambio, firma PSBT, transacciones y activos.

Pali también admite cuentas inteligentes passkey para instituciones y dapps avanzadas. Una dapp puede pedir a Pali que cree o recupere una cuenta inteligente respaldada por WebAuthn, adjuntar una política de módulos y luego ejecutar lotes atómicos mediante `wallet_sendCalls`.

Lo que hace diferente a Pali es la combinación: una sola extensión para flujos EVM y Syscoin UTXO, rutas de lectura rápidas con fallbacks de Multicall3 y RPC por lotes, cuentas normales y cuentas inteligentes modulares, estándares compatibles con MetaMask para dapps, y un modelo de seguridad de autocustodia donde las firmas, la recuperación y la política de cuenta se aplican mediante aprobaciones del usuario y módulos on-chain en lugar de un servidor de Pali. Consulta [¿Qué es Pali?](./start-here/what-is-pali.md) para ver el panorama completo.

## Elige tu camino

- **Usuarios** deben comenzar con [Primeros pasos](./users/getting-started.md).
- **Desarrolladores EVM** deben comenzar con [Descubrimiento de proveedor](./developers/provider-discovery.md) y [Resumen de la API EVM](./evm-api/overview.md).
- **Desarrolladores UTXO y Syscoin** deben comenzar con [Resumen de la API UTXO y Syscoin](./utxo-syscoin-api/overview.md).
- **Instituciones que usan passkeys** deben comenzar con [Passkeys e instituciones](./passkeys-institutions/overview.md).

## Superficies de proveedor

| Proveedor | Familia de cadena | Uso principal |
| --- | --- | --- |
| `window.ethereum` | EVM | Integraciones de dapp compatibles con MetaMask, firmas, transacciones, permisos y lotes EIP-5792. |
| `window.pali` | UTXO / Syscoin | Cuentas Syscoin UTXO, firma PSBT, flujos de xpub/dirección de cambio y helpers de activos. |

## Modelo de seguridad importante

Pali es intencionalmente conservador. Las dapps se conectan por host, las aprobaciones bloqueantes se serializan, las incompatibilidades de tipo de red se manejan explícitamente y los usuarios aprueban acciones sensibles en la UI de la extensión. Muchos sitios pueden estar conectados, pero cada sitio tiene una sola cuenta conectada activa a la vez.
