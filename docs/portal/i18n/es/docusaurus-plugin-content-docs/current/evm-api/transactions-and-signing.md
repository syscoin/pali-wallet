---
title: Transacciones y firma
---

Usa el proveedor EVM para transacciones, mensajes personales y datos tipados.

## Enviar una transacción

<figure>
  <a className="pali-media-link" href="/img/screens/evm-send-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/evm-send-review.png" alt="Pantalla de revisión de transacción EVM en Pali" />
</a>
  <figcaption>Las solicitudes de transacción se revisan en Pali antes de firmar y transmitir.</figcaption>
</figure>

```js
const [from] = await window.ethereum.request({
  method: 'eth_requestAccounts',
});

const hash = await window.ethereum.request({
  method: 'eth_sendTransaction',
  params: [
    {
      from,
      to: '0x0000000000000000000000000000000000000000',
      value: '0x0',
      data: '0x',
    },
  ],
});
```

## Personal sign

```js
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: ['0x48656c6c6f2050616c69', from],
});
```

## Firma de datos tipados

<figure>
  <a className="pali-media-link" href="/img/screens/typed-data-review.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/typed-data-review.png" alt="Pantalla de revisión de firma de datos tipados en Pali" />
</a>
  <figcaption>Pali valida y muestra datos tipados antes de la aprobación del usuario.</figcaption>
</figure>

```js
const signature = await window.ethereum.request({
  method: 'eth_signTypedData_v4',
  params: [from, JSON.stringify(typedData)],
});
```

Pali valida la estructura de datos tipados antes de mostrar el popup de firma. Las dapps deben usar JSON EIP-712 canónico y evitar depender de particularidades de parsing específicas de la billetera.

## Cuentas inteligentes y firma

Las cuentas inteligentes de Pali aprueban transacciones y flujos de firma mediante el módulo validador activo. El usuario aún aprueba en Pali. Si el validador usa passkey, el navegador o el sistema operativo también muestra un prompt WebAuthn.
