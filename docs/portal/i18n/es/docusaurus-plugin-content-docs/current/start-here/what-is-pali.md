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

## Qué hay de nuevo en Pali v4

Pali v4 es una modernización desde cero de la billetera en torno a tres ideas: velocidad, estándares y autoridad de firma flexible.

- **Más rápida en todas partes.** Pali agrupa el tráfico RPC por lotes en redes EVM y UTXO, de modo que los saldos, el historial y los datos de comisiones se cargan en muchos menos viajes de ida y vuelta. El resultado es una billetera que se siente instantánea en lugar de ocupada.
- **Cuentas inteligentes basadas en estándares.** Las cuentas inteligentes de Pali siguen el modelo de módulos ERC-7579 con codificación de ejecución estilo ERC-4337. Nada en la cuenta es un lock-in propietario: los validadores, los ejecutores y el comportamiento de la cuenta siguen especificaciones públicas.
- **La autorización está separada de la cuenta.** Quién puede firmar es una decisión de módulos, no una propiedad grabada en la dirección. Hoy eso significa claves ECDSA propiedad de la wallet y passkeys P-256 WebAuthn. Mañana puede significar nuevos tipos de validador — incluidos esquemas de firma post-cuánticos — instalados en la misma cuenta con la misma dirección, sin ningún ECDSA involucrado en la autorización de cada transacción.
- **Políticas de firma componibles.** Un validador composite combina validadores hijos bajo un threshold: 1-of-N para conveniencia, t-of-N para control compartido, N-of-N para máxima garantía. Los composites pueden anidarse, de modo que las políticas pueden ser jerárquicas.
- **Los guardianes protegen contra la pérdida de acceso.** Guardian recovery es un módulo separado con rol de ejecutor (según ERC-7579), deliberadamente distinto de los validadores. Los guardianes no pueden firmar transacciones; solo pueden programar un reemplazo de validador con timelock. Agrega o elimina guardianes en cualquier momento mientras la cuenta esté sana.

## Hacia dónde va Pali

La dirección de Pali es **autoridad de firma dinámica y flexible para frontends cripto**. Cualquier frontend — una dapp, un exchange, un panel institucional, un servicio embebido — debería poder pedir a la billetera exactamente la política de firma que el trabajo requiere: un passkey para un onboarding sin fricción, un composite t-of-N para una tesorería compartida, un guardián respaldado por hardware para la recuperación, o un tipo de validador futuro que aún no existe. La dirección de la cuenta se mantiene estable mientras la autoridad detrás de ella evoluciona.

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
