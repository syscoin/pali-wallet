---
title: Смарт-аккаунты и passkeys
---

Смарт-аккаунты Pali — это EVM contract accounts, контролируемые модулями. Passkey — один из поддерживаемых способов контроля; также доступны ECDSA и composite policies.

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pali settings screen for creating a smart account" />
</a>
  <figcaption>Пользователи могут создавать модульные смарт-аккаунты из настроек или по запросу dapp, а затем выбирать валидатор, который контролирует подтверждения.</figcaption>
</figure>

Думайте о валидаторах как об ответе на вопрос «кто может одобрять действия этого аккаунта?» — и полезно то, что ответ может меняться без смены самого аккаунта:

- **Любой из моих способов входа** (1-of-N): одобряйте тем passkey или ключом, который под рукой.
- **Несколько из нас вместе** (t-of-N): согласиться должен кворум людей или устройств — идеально для общих средств.
- **Все мы вместе** (N-of-N): одобрить должен каждый настроенный способ входа — для самых чувствительных аккаунтов.

Политики могут даже содержать другие политики, поэтому команда может выразить что-то вроде «ключ руководителя плюс любые два desk passkeys». Ваш адрес, балансы и история остаются точно такими же при смене политики — а поскольку подписание модульное, новые типы подписей (включая постквантовые) позже можно принять на том же аккаунте.

Guardians намеренно **не** входят в этот список. Guardian никогда не может одобрить транзакцию; его единственная возможность — запустить медленное, видимое восстановление, если вы потеряете доступ. Это разделение защищает вас от потери доступа, не давая никому повседневного контроля.

Они полезны для passkey approvals, team owners, batched actions и guardian recovery. Pali деплоит аккаунт детерминированно через factory и сохраняет долговечные metadata. Guardian recovery не мгновенная: guardian подписывает intent, модуль планирует его с delay, затем валидатор можно заменить.

On-chain guardian не ограничен обычным ключом: одобрения guardians проверяются через ECDSA или ERC-1271, поэтому guardian может быть и развернутым контрактным аккаунтом — включая другой смарт-аккаунт, чья собственная политика — composite-, кастомный или постквантовый валидатор. Путь восстановления тогда наследует схему подписи этого guardian. Текущие экраны guardians в Pali собирают одобрения на основе ключей; флоу для контрактных guardians можно добавить позже, потому что развернутый модуль их уже поддерживает.

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pali smart-account policy settings screen" />
</a>
  <figcaption>Экран политики смарт-аккаунта показывает установленные модули, детали активного валидатора, guardian recovery и управление модулями.</figcaption>
</figure>

## Ссылки на стандарты

- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-1271 contract signature validation](https://eips.ethereum.org/EIPS/eip-1271)
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
