---
title: Sponsor service
---

Sponsor service는 passkey smart account execution policy에 참여하는 institution-controlled endpoint입니다.

## Sponsor object

<figure>
  <a className="pali-media-link" href="/img/screens/sponsor-pending-success.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/sponsor-pending-success.png" alt="Pali sponsor relay pending 및 success state" />
</a>
  <figcaption>Sponsored execution은 pending, success, failure state를 사용자에게 명확히 보여줘야 합니다.</figcaption>
</figure>

```js
{
  mode: 'required',
  url: 'https://institution.example/sponsor/user-123',
  signer: '0xSponsorSignerAddress',
  policyText: 'Institution co-authorization is required.'
}
```

## Field 의미

| Field | 목적 |
| --- | --- |
| `mode` | `disabled`, `gasOnly`, 또는 `required`. |
| `url` | Pali가 sponsor execution support를 위해 contact하는 optional service endpoint. Pali는 service URL 없이는 remote gas sponsor가 없기 때문에 `gasOnly` sponsorship에 이를 요구합니다. |
| `signer` | required policy proof에 예상되는 sponsor signer address. `required` mode에 필요합니다. |
| `policyText` | wallet metadata에 저장되는 user-facing explanation. On-chain enforcement가 아닙니다. |

## On-chain policy

Smart account policy는 mode, signer, 공개 sponsor URL을 저장합니다. policy text는 display에 사용되는 wallet metadata입니다.

## Idempotency

Sponsor execution request는 passkey action hash에서 파생된 idempotency key를 사용합니다. sponsor service는 같은 key를 가진 repeated request를 같은 action으로 취급해야 합니다.

## Required sponsor mode

`required` mode에서는 sponsor proof가 configured signer로 recover되어야 합니다. Sponsor URL은 optional입니다. URL이 configured되어 있으면 Pali는 sponsor service에서 proof를 얻을 수 있고, configured signer가 wallet의 available account이면 local signing을 사용할 수 있습니다. Pali가 sponsor proof를 얻거나 검증할 수 없으면 execution은 실패합니다.

Gas payment는 sponsor authorization과 별개입니다. Valid sponsor proof가 있으면 Pali는 passkey execution에 선택된 funded software account에서 여전히 gas를 지불할 수 있습니다.

## Gas-only mode

`gasOnly` mode에서는 sponsor service가 relay하거나 gas 지불을 도울 수 있습니다. Pali는 이 mode에 sponsor URL을 요구합니다. URL이 gas sponsorship service를 식별하기 때문입니다. sponsorship을 사용할 수 없는 경우 policy가 허용하면 Pali는 wallet-gas execution으로 fallback할 수 있습니다.

## Institution guidance

- 안정적인 per-user sponsor URL을 사용하세요.
- signer key는 dapp frontend가 아니라 institutional infrastructure에 보관하세요.
- policy text는 짧고 구체적이며 이해하기 쉽게 만드세요.
- repeated idempotency key에 대해 일관된 status를 반환하세요.
- failed sponsor request와 expired execution deadline을 monitor하세요.
