---
title: Создание и восстановление passkey accounts
---

`wallet_createPasskeyAccount` создает новый passkey smart account для dapp onboarding. Pali создает или выбирает WebAuthn credential, deploys smart account on-chain, подтверждает deployed recovery metadata и записывает аккаунт в локальное состояние кошелька после подтверждения.

Локальное состояние кошелька представляет deployed passkey accounts. Восстановление доступно в настройках Pali для аккаунтов, которые уже существуют on-chain.

## Структура smart account и factory

Passkey system имеет две on-chain части:

- **Factory:** создает аккаунты, вычисляет counterfactual addresses, предоставляет recovery lookups и может deploy плюс execute первое действие.
- **Smart account:** хранит recovery metadata, nonce, sponsor policy и валидирует WebAuthn/P-256 execution proofs перед запуском calls.

Factory account parameters включают:

| Параметр | Значение |
| --- | --- |
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

## Поведение создания и deployment

Когда dapp запрашивает passkey account:

1. Pali проверяет, что активная chain поддерживает passkey smart accounts.
2. Pali создает fresh deployment salt для нового account path.
3. Pali получает или создает WebAuthn credential profile.
4. Pali вычисляет counterfactual address и deployment metadata.
5. Pali запрашивает у пользователя passkey assertion для deployment approval hash.
6. Pali отправляет `createAccount`, или `createAccountAndExecute`, когда требуется начальное действие sponsor policy, через настроенный deployment gas payer.
7. Pali ждет confirmation, читает recovery metadata smart account из chain и проверяет соответствие подготовленному credential и origin data.
8. После confirmation Pali создает локальный passkey account и подключает его к запрашивающей dapp.

Если итоговый адрес уже присутствует локально как deployed passkey account, Pali может повторно использовать этот локальный account.

## Что определяет адрес?

Адрес smart account derived из factory inputs, включая passkey public coordinates, credential hash, origin data, RP ID hash, deployment salt. Каждый новый account path использует fresh deployment salt, поэтому один credential может контролировать несколько smart accounts.

## Если пользователь теряет локальные данные Pali

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Экран настроек Pali для восстановления passkey smart accounts" />
</a>
  <figcaption>Экран восстановления обнаруживает on-chain passkey accounts, которые соответствуют восстановленному кошельку и authenticator.</figcaption>
</figure>

Если browser profile, extension storage или локальные metadata passkey account потеряны, chain все еще может содержать достаточно публичных metadata для восстановления аккаунта:

1. Pali запрашивает discoverable WebAuthn assertion у authenticator пользователя.
2. Pali запрашивает factory registry по credential hash.
3. Pali читает recovery metadata каждого candidate account.
4. Pali пропускает аккаунты, уже присутствующие локально.
5. Pali показывает matching accounts с балансом и необязательными индикаторами активности.
6. Pali импортирует выбранные accounts обратно в локальное состояние кошелька.

Восстановление в настройках обнаруживает deployed accounts, пропускает аккаунты, уже присутствующие локально, и позволяет выбрать, какие matching accounts импортировать.

## RP ID и имя credential

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Prompt passkey assertion в браузере или операционной системе" />
</a>
  <figcaption>Для восстановления и execution требуется WebAuthn assertion от соответствующего passkey credential.</figcaption>
</figure>

Браузер контролирует effective RP ID для extension-origin WebAuthn, если RP ID не предоставлен wallet path. Pali помечает default shared credential как `Pali Wallet Passkey` и использует запрошенный account label для user-facing account association.
