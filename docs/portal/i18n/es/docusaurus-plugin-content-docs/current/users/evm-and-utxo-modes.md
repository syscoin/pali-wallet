---
title: Modos EVM y UTXO
---

Pali admite redes EVM basadas en cuentas y redes basadas en UTXO. La extensión usa superficies de proveedor separadas porque los modelos de cuenta son fundamentalmente diferentes.

## Modo EVM

El modo EVM es para dapps que usan `window.ethereum`. Admite solicitudes de cuenta de estilo MetaMask, transacciones, firmas, permisos, solicitudes de observación de tokens y gestión de redes.

Ejemplos:

- dapps de Rollux y Syscoin NEVM
- interacciones ERC-20, ERC-721 y ERC-1155
- firma de datos tipados EIP-712
- creación y ejecución de cuentas inteligentes passkey

## Modo UTXO

El modo UTXO es para dapps que usan `window.pali`. Admite estado de cuenta Syscoin UTXO, integraciones con xpub, firma PSBT, transmisión de transacciones y flujos de activos SPT.

Ejemplos:

- aplicaciones de activos Syscoin UTXO
- flujos PSBT similares a Bitcoin
- dapps que necesitan una dirección de cambio
- dapps que leen historial de transacciones UTXO

## Cambiar modos

Si una dapp solicita un método para la familia de cadena incorrecta, Pali puede requerir un cambio de red. Las dapps deben manejar estos errores limpiamente y guiar a los usuarios a la red correcta.

```js
await window.ethereum.request({
  method: 'eth_changeUTXOEVM',
  params: [{ chainId: 57 }],
});

await window.pali.request({
  method: 'sys_changeUTXOEVM',
  params: [{ chainId: 57 }],
});
```

Cambiar entre contextos UTXO y EVM puede requerir reconectar la dapp porque cambia la familia de cuenta activa.
