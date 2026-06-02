---
title: 安装并连接
---

将 Pali 安装为浏览器扩展，解锁它，然后打开 dapp。Pali 会将 provider 注入顶层页面，使应用可以请求账户和操作。

## 检测 Pali

对于 EVM 集成，在可用时使用 EIP-6963。即使多个扩展都注入 provider，它也能让用户和 dapp 将 Pali 与其他钱包区分开来。

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

对于 UTXO 和 Syscoin 流程，检查 `window.pali`。

```js
if (!window.pali) {
  throw new Error('Pali UTXO provider is not available.');
}
```

## 连接 EVM 账户

<figure>
  <a className="pali-media-link" href="/img/screens/connect-dapp-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/connect-dapp-popup.png" alt="显示请求站点和账户选择的 Pali dapp 连接弹窗" />
</a>
  <figcaption>Pali 会在授予 dapp 访问权限前显示请求站点和账户。</figcaption>
</figure>

```js
const [address] = await window.ethereum.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## 连接 UTXO 账户

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## 处理拒绝和网络不匹配

用户可以拒绝连接请求。当活跃网络处于错误链家族时，Pali 也可能拒绝某个方法，例如钱包处于 EVM 模式时调用 `sys_requestAccounts`。

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

## 加载本地开发构建

<figure>
  <a className="pali-media-link" href="/img/screens/install-unlocked-wallet.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/install-unlocked-wallet.png" alt="在干净浏览器配置文件中已安装并解锁的 Pali Wallet" />
</a>
  <figcaption>捕获安装和解锁流程时，请使用干净的测试配置文件。</figcaption>
</figure>

从钱包仓库执行：

```bash
yarn install
yarn dev:chrome
```

然后打开 `chrome://extensions`，启用开发者模式，选择加载已解压扩展，并选择生成的 `build/chrome` 目录。
