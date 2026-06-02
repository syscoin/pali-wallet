---
title: Instalar y conectar
---

Instala Pali como extensión de navegador, desbloquéala y abre una dapp. Pali inyecta proveedores en páginas de nivel superior para que las aplicaciones puedan solicitar cuentas y acciones.

## Detectar Pali

Usa EIP-6963 cuando esté disponible para integraciones EVM. Permite que usuarios y dapps distingan Pali de otras billeteras incluso cuando varias extensiones inyectan proveedores.

```js
const providers = [];

window.addEventListener('eip6963:announceProvider', (event) => {
  providers.push(event.detail);
});

window.dispatchEvent(new Event('eip6963:requestProvider'));

const pali = providers.find(({ info }) => {
  const name = info.name.toLowerCase();
  const rdns = info.rdns.toLowerCase();
  return name.includes('pali') || rdns.includes('pali');
});
```

Para flujos UTXO y Syscoin, comprueba `window.pali`.

```js
if (!window.pali) {
  throw new Error('Pali UTXO provider is not available.');
}
```

## Conectar cuentas EVM

<figure>
  <a className="pali-media-link" href="/img/screens/connect-dapp-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/connect-dapp-popup.png" alt="Popup de conexión de dapp de Pali que muestra el sitio solicitante y la selección de cuenta" />
</a>
  <figcaption>Pali muestra el sitio solicitante y la cuenta antes de conceder acceso a la dapp.</figcaption>
</figure>

```js
const [address] = await window.ethereum.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## Conectar cuentas UTXO

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Manejar rechazo e incompatibilidad de red

Los usuarios pueden rechazar solicitudes de conexión. Pali también puede rechazar un método cuando la red activa pertenece a la familia de cadena incorrecta, como llamar `sys_requestAccounts` mientras la billetera está en modo EVM.

```js
try {
  await window.pali.request({ method: 'sys_requestAccounts', params: [] });
} catch (error) {
  if (error.code === 4001) {
    console.log('The user rejected the request.');
  } else {
    console.error('Pali request failed', error);
  }
}
```

## Cargar una compilación local de desarrollo

<figure>
  <a className="pali-media-link" href="/img/screens/install-unlocked-wallet.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/install-unlocked-wallet.png" alt="Pali Wallet instalada y desbloqueada en un perfil de navegador limpio" />
</a>
  <figcaption>Usa un perfil de prueba limpio al capturar flujos de instalación y desbloqueo.</figcaption>
</figure>

Desde el repositorio de la billetera:

```bash
yarn install
yarn dev:chrome
```

Luego abre `chrome://extensions`, habilita Developer Mode, elige Load unpacked y selecciona el directorio generado `build/chrome`.
