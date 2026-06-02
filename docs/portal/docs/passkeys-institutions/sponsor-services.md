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
| `url` | Service endpoint Pali contacts for sponsor execution support. |
| `signer` | Expected sponsor signer address for required policy proofs. |
| `policyText` | User-facing explanation stored in wallet metadata. Not on-chain enforcement. |

## On-chain policy

The smart account policy stores mode, signer, and URL hash. The full URL and policy text are wallet metadata used for display and sponsor service calls.

## Idempotency

Sponsor execution requests use an idempotency key derived from the passkey action hash. A sponsor service should treat repeated requests with the same key as the same action.

## Required sponsor mode

In `required` mode, the sponsor proof must recover to the configured signer. If Pali cannot obtain or validate the sponsor proof, execution fails.

## Gas-only mode

In `gasOnly` mode, the sponsor service may relay or help pay gas. If sponsorship is unavailable, Pali can fall back to wallet-gas execution where policy allows it.

## Institution guidance

- Use stable per-user sponsor URLs.
- Keep signer keys in institutional infrastructure, not in the dapp frontend.
- Make policy text short, specific, and understandable.
- Return consistent status for repeated idempotency keys.
- Monitor failed sponsor requests and expired execution deadlines.
