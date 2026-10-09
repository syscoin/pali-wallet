---
title: Detección de tokens y API de exploradores
---

Pali puede usar la API de un explorador para encontrar tokens y NFT que puedes importar. También puedes agregar un activo por su dirección de contrato. Los saldos de los tokens importados se consultan mediante el RPC de la red, por lo que la detección automática es opcional.

## Qué funciona de forma predeterminada

| Red                       | Detección automática                                                                                     | Si falta un activo                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Red principal de Ethereum | Routescan, sin cuenta ni clave de API. Admite tokens ERC-20 y tenencias de ERC-721/ERC-1155 compatibles. | Usa **Importar Token → Agregar Personalizado**.                                                                  |
| Base                      | No hay una API de detección predeterminada. La red y su RPC siguen disponibles.                          | Agrega activos por su dirección de contrato o configura una API de explorador compatible a la que tengas acceso. |
| Arbitrum One              | No hay una API de detección predeterminada. La red y su RPC siguen disponibles.                          | Agrega activos por su dirección de contrato o configura una API de explorador compatible a la que tengas acceso. |
| Otras redes EVM           | Depende de la API de explorador configurada para esa red.                                                | Usa **Agregar Personalizado** si la detección no está disponible.                                                |

Cuando no hay una API de explorador configurada, Pali abre **Agregar Personalizado**, oculta **Tus Tokens** y explica cómo agregar activos o configurar una API. Borrar una URL de API no elimina la red ni sus activos importados. Sin una API de explorador, el historial de transacciones depende de las transacciones guardadas localmente y de las consultas RPC; es posible que no pueda recuperar todo el historial anterior.

## Agregar un token o NFT manualmente

1. Selecciona la red y la cuenta correctas.
2. Abre **Importar Token → Agregar Personalizado**.
3. Introduce la dirección del contrato del activo en esa red.
4. Revisa los detalles del activo detectado. Para un activo ERC-1155, introduce también su ID de token.
5. Importa el activo.

Usa la dirección del contrato publicada por el proyecto o mostrada en un explorador de confianza. Contratos no relacionados pueden usar el mismo nombre de token, y una dirección en una red puede identificar un activo diferente en otra.

## Configurar una API de explorador

Una URL de RPC, un sitio web de explorador y una URL de API de explorador tienen funciones diferentes. El RPC conecta Pali a la red; el sitio web del explorador abre direcciones y transacciones en tu navegador; la API del explorador proporciona las tenencias y el historial indexados.

1. Abre el selector de redes de Pali y elige **Administrar redes**.
2. Selecciona el icono del lápiz junto a la red EVM que quieres editar.
3. Busca **URL de API del Explorador de Bloques (opcional)**. Pega la URL de API correspondiente de los ejemplos siguientes. Conserva tu URL de RPC y tu ID de cadena actuales, salvo que también quieras cambiar esos ajustes.
4. Elige **Guardar**. Pali comprueba el RPC y el acceso básico a la API del explorador antes de guardar. Una comprobación de acceso correcta no garantiza que se admitan todos los endpoints de detección o historial.
5. Cambia a otra red y luego vuelve a la red que editaste. Esto actualiza su configuración de API activa. Vuelve a abrir **Importar Token → Tus Tokens** para cargar las tenencias con la nueva API.

Para agregar una red nueva, elige **RPC personalizado** en el selector de redes. Su formulario incluye el mismo campo opcional de API de explorador. Para desactivar la detección indexada en una red, borra ese campo y guarda.

## Formatos compatibles y ejemplos de URL

### Ethereum: Routescan

La URL de API integrada para Ethereum es:

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api
```

Déjala sin clave para usar el acceso público. Pali usa las API de tenencias de Routescan para la detección y su API compatible con Etherscan para el historial de transacciones. La indexación del proveedor puede estar incompleta o retrasada. Cambiar el número de cadena en esta URL no confirma que Routescan admita otra red. Consulta la [referencia de la API de Routescan](https://routescan.io/docs/api) para conocer su cobertura y sus endpoints.

Actualmente, Routescan documenta un límite sin clave de **2 solicitudes por segundo y 10.000 llamadas al día**. Pali espacia las solicitudes y almacena los resultados en caché, pero los límites del proveedor siguen aplicándose. Consulta los [límites actuales de Routescan](https://routescan.io/docs/plans-and-limits/rate-limits) y sus [planes](https://routescan.io/docs/plans-and-limits/api-keys-and-pricing).

Para usar una clave de API personal de Routescan, sustituye `YOUR_API_KEY` en:

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?apikey=YOUR_API_KEY
```

Pali envía este valor en el [encabezado de solicitud `apikey`](https://routescan.io/docs/api/conventions) del proveedor. Se aplican los límites de tu plan del proveedor.

### Detección compatible con Blockscout

Pali también admite API de exploradores que implementan el formato de solicitud **account/tokenlist** de Blockscout. Configura la URL base de la API y cualquier selector de cadena o clave de API necesarios; Pali proporciona la dirección de la cuenta y los parámetros de la solicitud de detección. Consulta la [documentación de la lista de tokens de Blockscout](https://docs.blockscout.com/devs/apis/rpc/account).

Por ejemplo, una API de Blockscout alojada por ti o compatible con tu proveedor puede usar:

```text
https://YOUR_BLOCKSCOUT_HOST/api
```

Si ese proveedor requiere autenticación mediante parámetros de consulta:

```text
https://YOUR_BLOCKSCOUT_HOST/api?apikey=YOUR_API_KEY
```

El host y la clave anteriores son marcadores de posición. Usa un servicio que admita la red seleccionada y permita tus solicitudes; una URL del sitio web de un explorador por sí sola no es suficiente.

Para **Base**, Blockscout documenta este formato de API PRO:

```text
https://api.blockscout.com/v2/api?chain_id=8453&apikey=YOUR_API_KEY
```

La API de Base de Blockscout requiere una clave autorizada y un plan de pago. Obtén la clave en el [portal de desarrolladores de Blockscout](https://dev.blockscout.com), confirma que tu plan permite acceder a esa red y sustituye `YOUR_API_KEY`. El selector es **`chain_id`**, con un guion bajo. Este ejemplo sigue la [documentación oficial de la API de Base](https://docs.blockscout.com/base-api); no es una alternativa pública sin clave.

Para **Arbitrum One**, el selector de cadena equivalente es `42161`:

```text
https://api.blockscout.com/v2/api?chain_id=42161&apikey=YOUR_API_KEY
```

Confirma con Blockscout el acceso a Arbitrum y la compatibilidad de los endpoints antes de usar esa configuración. La URL sigue su formato multicadena documentado; la disponibilidad depende de tu cuenta y tu plan. Pali no incluye una clave compartida de Blockscout.

### Etherscan y Alchemy

Una URL de API de Etherscan V2 puede atender solicitudes de historial de transacciones compatibles cuando tu clave y tu plan lo permiten:

```text
https://api.etherscan.io/v2/api?chainid=1&apikey=YOUR_API_KEY
```

Usa el ID de cadena de la red seleccionada y comprueba los [requisitos de endpoints y planes de Etherscan](https://docs.etherscan.io/api-reference/endpoint/txlist). **Un historial compatible con Etherscan no implica detección automática de tokens.** Pali no implementa el [endpoint PRO independiente de tenencias de tokens](https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance) de Etherscan; una clave de Etherscan por sí sola no habilita **Tus Tokens**.

Las API de tokens de Alchemy usan solicitudes y respuestas diferentes, entre ellas [alchemy_getTokenBalances](https://www.alchemy.com/docs/data/token-api/token-api-endpoints/alchemy-get-token-balances). Pali no tiene un adaptador de detección de tokens para Alchemy. Puedes usar un endpoint RPC de Alchemy en el campo **URL de RPC** si es adecuado para tu red, pero no sustituye al campo **URL de API del Explorador de Bloques**.

## Claves de API y privacidad

Una clave de API de explorador autoriza el acceso a ese proveedor y puede consumir tu cuota de uso. Es distinta de la clave privada o la frase de recuperación de tu billetera. Nunca introduzcas una clave privada de billetera ni una frase de recuperación en una URL de API.

Pali guarda la URL de API configurada en los ajustes de red de la extensión. Una clave incluida en esa URL es visible para cualquiera que pueda inspeccionar esos ajustes o las solicitudes de la extensión. Elimina las claves antes de compartir capturas de pantalla, registros o ejemplos de configuración. Los servicios de exploradores también reciben las direcciones públicas de las cuentas que les pides consultar. Consulta [Privacidad y seguridad](./privacy-and-safety).

## Resultados vacíos, API no disponibles y reintentos

- **No hay tokens adicionales para importar:** la API no devolvió tenencias adicionales compatibles tras excluir los activos ya importados. Esto no demuestra que la cuenta no tenga activos; la indexación y la cobertura de activos pueden estar incompletas.
- **La detección no está configurada:** la red no tiene una URL de API de explorador. Usa **Agregar Personalizado** o configura un servicio compatible mediante **Administrar redes**.
- **API no disponible / acceso prohibido:** comprueba el endpoint del proveedor, la cadena seleccionada, la clave de API y el plan. Una respuesta `403` indica que el proveedor rechazó el acceso.
- **Demasiadas solicitudes:** una respuesta `429` significa que el proveedor está limitando las solicitudes. Su cuota puede estar agotada incluso cuando abres la lista por primera vez. Espera antes de usar **Reintentar** y comprueba los límites de uso del proveedor si los errores continúan.

Un fallo de detección no demuestra que el saldo de un token sea cero. Puedes seguir usando **Agregar Personalizado** y las consultas de saldos mediante RPC mientras un indexador no esté disponible.
