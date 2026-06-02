---
title: Установка и подключение
---

Установите Pali как браузерное расширение, разблокируйте его и откройте dapp. Pali внедряет провайдеры в страницы верхнего уровня, чтобы приложения могли запрашивать аккаунты и действия.

## Обнаружить Pali

Используйте EIP-6963 для EVM-интеграций, когда он доступен. Он позволяет пользователям и dapps отличать Pali от других кошельков даже когда несколько расширений внедряют провайдеры.

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

Для UTXO и Syscoin flows проверьте `window.pali`.

```js
if (!window.pali) {
  throw new Error('Pali UTXO provider is not available.');
}
```

## Подключить EVM аккаунты

<figure>
  <a className="pali-media-link" href="/img/screens/connect-dapp-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/connect-dapp-popup.png" alt="Popup подключения Pali dapp с запрашивающим сайтом и выбором аккаунта" />
</a>
  <figcaption>Pali показывает запрашивающий сайт и аккаунт перед предоставлением dapp доступа.</figcaption>
</figure>

```js
const [address] = await window.ethereum.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## Подключить UTXO аккаунты

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Обработать отказ и несовпадение сети

Пользователи могут отклонять запросы на подключение. Pali также может отклонить метод, когда активная сеть относится к неправильному семейству цепей, например при вызове `sys_requestAccounts`, пока кошелек находится в EVM mode.

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

## Загрузить локальную development build

<figure>
  <a className="pali-media-link" href="/img/screens/install-unlocked-wallet.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/install-unlocked-wallet.png" alt="Pali Wallet установлен и разблокирован в чистом профиле браузера" />
</a>
  <figcaption>Используйте чистый тестовый профиль при записи flows установки и разблокировки.</figcaption>
</figure>

Из репозитория кошелька:

```bash
yarn install
yarn dev:chrome
```

Затем откройте `chrome://extensions`, включите Developer Mode, выберите Load unpacked и укажите сгенерированную директорию `build/chrome`.
