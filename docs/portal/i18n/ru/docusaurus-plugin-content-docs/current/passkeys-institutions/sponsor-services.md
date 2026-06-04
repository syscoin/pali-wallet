---
title: Сервисы sponsor
---

Sponsor service — это endpoint, контролируемый институцией, который участвует в passkey smart account execution policy.

## Объект sponsor

<figure>
  <a className="pali-media-link" href="/img/screens/sponsor-pending-success.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/sponsor-pending-success.png" alt="Состояния pending и success sponsor relay в Pali" />
</a>
  <figcaption>Sponsored execution должен ясно показывать пользователям pending, success и failure states.</figcaption>
</figure>

```js
{
  mode: 'required',
  url: 'https://institution.example/sponsor/user-123',
  signer: '0xSponsorSignerAddress',
  policyText: 'Institution co-authorization is required.'
}
```

## Значение полей

| Поле | Назначение |
| --- | --- |
| `mode` | `disabled`, `gasOnly` или `required`. |
| `url` | Опциональный service endpoint, с которым Pali связывается для sponsor execution support. Pali требует его для `gasOnly` sponsorship, потому что без service URL нет remote gas sponsor. |
| `signer` | Ожидаемый sponsor signer address для required policy proofs. Обязателен для режима `required`. |
| `policyText` | User-facing explanation, сохраненное в wallet metadata. Не on-chain enforcement. |

## On-chain policy

Smart account policy хранит mode, signer и публичный sponsor URL. Policy text — это wallet metadata, используемые для отображения.

## Идемпотентность

Sponsor execution requests используют idempotency key, derived из passkey action hash. Sponsor service должен считать повторные запросы с тем же key тем же действием.

## Режим required sponsor

В режиме `required` sponsor proof должен recover к настроенному signer. Sponsor URL опционален: Pali может получить proof от sponsor service, когда URL настроен, или подписать локально, когда настроенный signer является доступным аккаунтом в wallet. Если Pali не может получить или валидировать sponsor proof, execution fails.

Оплата gas отделена от sponsor authorization. После получения валидного sponsor proof Pali всё ещё может оплатить gas с любого funded software account, выбранного для passkey execution.

## Режим gas-only

В режиме `gasOnly` sponsor service может relay или помочь оплатить gas. Pali требует sponsor URL для этого режима, потому что URL идентифицирует gas sponsorship service. Если sponsorship недоступен, Pali может fallback к wallet-gas execution там, где policy это разрешает.

## Рекомендации для институций

- Используйте стабильные per-user sponsor URLs.
- Храните signer keys в institutional infrastructure, а не во frontend dapp.
- Делайте policy text коротким, конкретным и понятным.
- Возвращайте consistent status для повторяющихся idempotency keys.
- Мониторьте failed sponsor requests и expired execution deadlines.
