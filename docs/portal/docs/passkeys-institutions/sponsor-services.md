---
title: Sponsor services
---

A sponsor service is an institution-controlled endpoint that participates in passkey smart account execution policy.

## Sponsor object

<figure>
  <a className="pali-media-link" href="/img/screens/sponsor-pending-success.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/sponsor-pending-success.png" alt="Pali sponsor relay pending and success states" />
</a>
  <figcaption>Sponsored execution should make pending, success, and failure states clear to users.</figcaption>
</figure>

```js
{
  mode: 'required',
  url: 'https://institution.example/sponsor/user-123',
  signer: '0xSponsorSignerAddress',
  policyText: 'Institution co-authorization is required.'
}
```

## Field meaning

| Field | Purpose |
| --- | --- |
| `mode` | `disabled`, `gasOnly`, or `required`. |
| `url` | Optional service endpoint Pali contacts for sponsor execution support. Pali requires it for `gasOnly` sponsorship because there is no remote gas sponsor without a service URL. |
| `signer` | Expected sponsor signer address for required policy proofs. Required for `required` mode. |
| `policyText` | User-facing explanation stored in wallet metadata. Not on-chain enforcement. |

## On-chain policy

The smart account policy stores mode, signer, and a bounded public sponsor URL. Policy text remains wallet metadata used for display and is not enforced on-chain.

## Idempotency

Sponsor execution requests use an idempotency key derived from the passkey action hash. A sponsor service should treat repeated requests with the same key as the same action.

## Required sponsor mode

In `required` mode, the sponsor proof must recover to the configured signer. The sponsor URL is optional: Pali can obtain proof from the sponsor service when a URL is configured, or sign locally when the configured signer is an available account in the wallet. If Pali cannot obtain or validate the sponsor proof, execution fails.

Gas payment is separate from sponsor authorization. After a valid sponsor proof is available, Pali can still pay gas from any funded software account selected for passkey execution.

## Gas-only mode

In `gasOnly` mode, the sponsor service may relay or help pay gas. Pali requires a sponsor URL for this mode because the URL is what identifies the gas sponsorship service. If sponsorship is unavailable, Pali can fall back to wallet-gas execution where policy allows it.

## Institution guidance

- Use stable public sponsor URLs and keep user-specific or secret data in POST bodies or signed sponsor payloads.
- Keep signer keys in institutional infrastructure, not in the dapp frontend.
- Make policy text short, specific, and understandable.
- Return consistent status for repeated idempotency keys.
- Monitor failed sponsor requests and expired execution deadlines.
