---
title: Создание и восстановление passkey accounts
---

`wallet_createPasskeyAccount` намеренно идемпотентен для dapp onboarding. Pali проверяет recoverable on-chain accounts перед созданием нового пути credential/account.

## Структура smart account и factory

Passkey system имеет две on-chain части:

- **Factory:** создает аккаунты, вычисляет counterfactual addresses, предоставляет recovery lookups и может deploy плюс execute первое действие.
- **Smart account:** хранит recovery metadata, nonce, sponsor policy и валидирует WebAuthn/P-256 execution proofs перед запуском calls.

Factory account parameters включают:

| Параметр | Значение |
| --- | --- |
| `recoveryId` | Wallet-scoped recovery anchor, derived из Pali wallet context, chain id и factory address. |
| `passkeyX`, `passkeyY` | Координаты P-256 public key, извлеченные из WebAuthn credential. |
| `credentialIdHash` | Hash WebAuthn credential id. |
| `rpIdHash` | WebAuthn RP ID hash из authenticator data. |
| `originHash`, `originLength` | Extension-origin binding data из WebAuthn client data. |
| `salt` | Deployment salt, позволяющий одному credential контролировать больше одного smart account. |

Smart account предоставляет execution, signature validation, nonce, sponsor policy и чтение recovery metadata. Pali использует эти metadata, чтобы реконструировать аккаунты после потери локального состояния.

## Создание с отключенным sponsorship

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: {
        mode: 'disabled',
      },
    },
  ],
});
```

## Создание с sponsor policy

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-required.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-required.png" alt="Popup создания passkey account в Pali с деталями required sponsor policy" />
</a>
  <figcaption>Required sponsorship показывает sponsor URL, signer и policy text перед подтверждением пользователя.</figcaption>
</figure>

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Institution Managed Account',
      sponsor: {
        mode: 'required',
        url: 'https://institution.example/sponsor/user-123',
        signer: '0xSponsorSignerAddress',
        policyText:
          'This account requires institution co-authorization for execution.',
      },
    },
  ],
});
```

## Поведение recovery-before-create

Когда dapp запрашивает passkey account:

1. Pali проверяет, что активная chain поддерживает passkey smart accounts.
2. Pali проверяет, может ли passkey восстановить on-chain account, matching запрошенной sponsor policy.
3. Если matching account существует локально, Pali повторно использует его.
4. Если matching account существует on-chain, но не локально, Pali импортирует его.
5. Если account существует для того же sponsor URL hash, но mode или signer отличаются, Pali отклоняет с recovery mismatch.
6. Если matching account не существует, Pali продолжает создание нового аккаунта.

## Что определяет адрес?

Адрес smart account derived из factory inputs, включая passkey public coordinates, credential hash, origin data, RP ID hash, recovery ID и deployment salt. Текст sponsor URL сам по себе не является address seed, но sponsor policy используется recovery matching logic для institution-scoped onboarding.

## Если пользователь теряет локальные данные Pali

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Экран настроек Pali для восстановления passkey smart accounts" />
</a>
  <figcaption>Экран восстановления обнаруживает on-chain passkey accounts, которые соответствуют восстановленному кошельку и authenticator.</figcaption>
</figure>

Если browser profile, extension storage или локальные metadata passkey account потеряны, chain все еще может содержать достаточно публичных metadata для восстановления аккаунта:

1. Пользователь восстанавливает или открывает Pali с wallet context, который привязывает recovery ID.
2. Pali запрашивает discoverable WebAuthn assertion у authenticator пользователя.
3. Pali запрашивает factory registry по recovery ID и credential hash.
4. Pali читает recovery metadata каждого candidate account.
5. Pali пропускает аккаунты, уже присутствующие локально.
6. Pali импортирует matching accounts обратно в локальное состояние кошелька.

Для dapp-driven create/recover Pali также сравнивает sponsor mode, signer и URL hash восстановленного аккаунта с sponsor policy, запрошенной dapp. Это предотвращает ситуацию, когда институция незаметно привязывает пользователя к другой sponsor policy, чем та, которую запросил dapp.

## RP ID и имя credential

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Prompt passkey assertion в браузере или операционной системе" />
</a>
  <figcaption>Для восстановления и execution требуется WebAuthn assertion от соответствующего passkey credential.</figcaption>
</figure>

Браузер контролирует effective RP ID для extension-origin WebAuthn, если RP ID не предоставлен wallet path. Pali помечает default shared credential как `Pali Wallet Passkey` и использует запрошенный account label для user-facing account association.
