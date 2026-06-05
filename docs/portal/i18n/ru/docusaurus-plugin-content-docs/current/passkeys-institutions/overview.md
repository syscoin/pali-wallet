---
title: Passkeys и институции
---

Pali passkey smart accounts позволяют dapp запрашивать создание или восстановление аккаунта у кошелька, пока пользователь контролирует execution через WebAuthn.

Это полезно для:

- institutional onboarding
- sponsor-backed gas flows
- co-authorized policies
- восстановления аккаунта после переустановки кошелька
- atomic multi-call workflows
- dapps, которым нужен passkey UX без создания кошелька

## Почему zkSYS passkeys возможны

Passkeys используют WebAuthn, а стандартный алгоритм подписи WebAuthn — ES256: ECDSA по кривой P-256, также известной как secp256r1. Обычные EVM wallets обычно используют secp256k1 EOAs, поэтому passkey signature напрямую не является EOA signature.

Passkey accounts Pali — это zkSYS smart accounts, спроектированные вокруг on-chain P-256 verification. Кошелек извлекает координаты WebAuthn public key, challenge, authenticator data, client data и P-256 signature, затем smart account/factory path проверяет этот proof против зарегистрированных metadata аккаунта. Именно это делает biometrics устройства или platform passkeys пригодными для authorizing account при сохранении приватного ключа внутри authenticator пользователя.

Практический результат — wallet UX, который ощущается как biometric login, но авторизует chain action:

1. Dapp запрашивает passkey smart account или batch execution.
2. Pali подготавливает action hash для точной chain, account, calls, nonce, deadline и sponsor policy.
3. Browser/OS просит пользователя подтвердить passkey.
4. zkSYS smart account проверяет P-256 WebAuthn proof on-chain перед выполнением.

## Поддерживаемые сети

Passkey accounts включены не на каждой EVM chain. Им нужны настроенная passkey factory и поддержка zkSYS P-256 verification.

| Сеть | Chain id | Статус в этой сборке Pali |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | Настроено. Factory: `0x04a52bc8B5fadBfeBBAF927832d545a270cA0cAb`. |
| `zkSYS` | TBD in wallet config | Планируемая production target для той же passkey architecture после настройки factory address в Pali. |

Если dapp вызывает `wallet_createPasskeyAccount` в сети без настроенной factory, Pali отклоняет запрос вместо создания неподдерживаемых metadata.

## Метод dapp

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-disabled.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-disabled.png" alt="Popup Pali wallet_createPasskeyAccount с отключенным sponsorship" />
</a>
  <figcaption>Default dapp-driven passkey flow должен начинаться с отключенного sponsorship, если институции явно не нужна sponsor policy.</figcaption>
</figure>

```js
const account = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: { mode: 'disabled' },
    },
  ],
});
```

Результат включает `address` smart account и публичные passkey metadata.

## Режимы sponsor

| Режим | Значение |
| --- | --- |
| `disabled` | Нет sponsor policy. Кошелек/пользователь платит gas. |
| `gasOnly` | Sponsor service может платить gas. Pali требует sponsor URL для этого режима; если sponsorship fails, может быть разрешен wallet-gas fallback. |
| `required` | Sponsor co-authorization требуется policy. Signer обязателен; sponsor URL опционален, когда Pali может получить signer proof от локального аккаунта в wallet. |

## Контроль пользователя

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Лист создания passkey в браузере или операционной системе" />
</a>
  <figcaption>После wallet review браузер или операционная система обрабатывает создание WebAuthn passkey.</figcaption>
</figure>

Пользователь видит запрашивающий сайт, label, sponsor mode, signer, URL и policy text перед подтверждением. Затем browser или OS показывает WebAuthn passkey prompt.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Passkey dapp onboarding flow"></video>
  <figcaption>Passkey onboarding flow: branded intro, запрос dapp и подтверждение аккаунта Pali.</figcaption>
</figure>
