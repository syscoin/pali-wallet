---
title: ¿Qué es Pali?
---

Pali Wallet es la extensión de billetera oficial de Syscoin y una billetera web3 de propósito general para cadenas compatibles con EVM. Está diseñada para tres audiencias superpuestas:

- **Usuarios regulares** que quieren una billetera de navegador segura para EVM, Syscoin, Rollux y activos UTXO.
- **Desarrolladores de dapps** que quieren acceso EVM compatible con MetaMask y acceso UTXO desde la misma extensión.
- **Instituciones** que quieren cuentas inteligentes passkey, recuperación de cuentas, política de módulos y onboarding impulsado por dapps.

## Qué hace diferente a Pali

La mayoría de las billeteras de navegador exponen solo un proveedor EVM. Pali expone dos superficies complementarias:

- `window.ethereum` para dapps EVM, intencionalmente compatible con los flujos comunes de MetaMask.
- `window.pali` para flujos Syscoin UTXO y de estilo Bitcoin.

Esto permite que una dapp construya experiencias que atraviesan cadenas basadas en cuentas y basadas en UTXO sin pedir a los usuarios que instalen billeteras diferentes.

## ¿Qué diferencia a Pali?

Pali se construye alrededor de una idea: la billetera debe ser el límite de seguridad del usuario, no un servidor. Pali puede leer desde nodos RPC, exploradores e indexadores como cualquier billetera de navegador, pero la custodia, las aprobaciones, la recuperación y la política de cuenta permanecen con las claves del usuario y los módulos on-chain.

- **Sin servidor de custodia ni recuperación.** Pali no guarda una clave del lado del servidor, datos cifrados en la nube, un motor de políticas ni una puerta trasera de recuperación. Las acciones sensibles se aprueban en la extensión, las firma la billetera, passkey, dispositivo hardware o validador de cuenta inteligente del usuario, y las hace cumplir la chain.
- **Lecturas rápidas con fallbacks seguros.** Cuando Pali necesita muchas lecturas de contratos EVM, primero intenta Multicall3 `aggregate3`: un `eth_call` on-chain, una vista del mismo bloque y aislamiento de fallos por llamada. Si Multicall3 no está desplegado o el RPC lo rechaza, Pali usa batch JSON-RPC; si el batch no está disponible, vuelve a llamadas individuales.
- **Dos familias de chains en una billetera.** Pali expone `window.ethereum` compatible con MetaMask para dapps EVM y `window.pali` para flujos Syscoin UTXO / estilo Bitcoin. Una dapp puede trabajar con activos basados en cuentas, UTXOs, PSBTs y xpubs desde una sola extensión en lugar de enviar a los usuarios a billeteras separadas.
- **Cuentas normales y cuentas inteligentes.** Los usuarios pueden mantener cuentas estilo EOA, cuentas de hardware wallet y cuentas inteligentes Pali lado a lado. Las cuentas normales son simples y portables. Las cuentas inteligentes agregan política programable: passkeys, validadores ECDSA propiedad de la billetera, políticas de umbral compuesto, recuperación con guardianes y módulos personalizados.
- **Integración dapp basada en estándares.** Pali sigue las APIs de billetera que las dapps ya usan: EIP-1193, EIP-6963, permisos EIP-2255, EIP-5792 `wallet_sendCalls`, datos tipados EIP-712 y comportamiento de solicitudes compatible con MetaMask. Las cuentas inteligentes Pali usan módulos validador/ejecutor estilo ERC-7579 y datos de ejecución estilo ERC-4337.
- **Autorización programable.** En una cuenta inteligente Pali, la dirección es estable pero la política de firma puede evolucionar. Un validador decide quién puede aprobar acciones; un ejecutor agrega funciones como recuperación con guardianes. Eso permite cambiar de una passkey a una política de umbral, agregar recuperación o adoptar nuevos tipos de validadores sin mover fondos.
- **Diseñada para firmas futuras más fuertes.** Como la autorización es modular, los validadores futuros pueden admitir esquemas más allá de ECDSA y passkeys P-256, incluidos diseños post-cuánticos cuando sean prácticos para la chain objetivo.
- **Seguridad antes que conveniencia.** Pali serializa las aprobaciones bloqueantes, revisa sitios conectados y contexto de red, bloquea aciertos de blacklist de alto riesgo para envíos y aprobaciones, y mantiene la recuperación con guardianes separada de la firma de transacciones. Los guardianes pueden ayudar a recuperar acceso tras un retraso; no pueden gastar fondos silenciosamente.

La dirección de Pali es **cuentas programables de autocustodia para usuarios reales y dapps reales**: lo bastante rápidas para el uso diario, lo bastante estándar para desarrolladores, lo bastante flexibles para instituciones y lo bastante conservadoras para que el control crítico de seguridad permanezca con el usuario y la chain.

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
| Creación de cuenta inteligente passkey | `wallet_prepareSmartAccount` |

## Alcance actual de passkey

Las cuentas inteligentes de Pali están disponibles en redes EVM donde la factory y los módulos de Pali existen en las direcciones que Pali usa. Esta build de Pali configura la testnet `zkTanenbaum` (`57057`), y el soporte de producción zkSYS usa la misma arquitectura una vez que las direcciones de producción estén configuradas.

La infraestructura no está limitada a cadenas operadas por Pali. En redes EVM compatibles con soporte CREATE2 canónico, Pali puede desplegar la configuración de cuenta inteligente requerida directamente desde la wallet: abre Pali Settings, ve a Advanced y usa el botón Deploy en **Smart account setup**. Los validadores passkey necesitan verificación P-256 WebAuthn, que muchos entornos EVM modernos proporcionan mediante un precompile P-256/passkey.
