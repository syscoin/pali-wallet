---
title: Passkey 계정 생성 및 복구
---

`wallet_createPasskeyAccount`는 dapp onboarding을 위해 의도적으로 idempotent합니다. Pali는 새 credential/account path를 만들기 전에 recoverable on-chain account를 확인합니다.

## Smart account 및 factory 구조

passkey system에는 두 개의 on-chain 구성 요소가 있습니다.

- **Factory:** account를 만들고, counterfactual address를 계산하며, recovery lookup을 노출하고, 첫 action을 deploy와 함께 execute할 수 있습니다.
- **Smart account:** recovery metadata, nonce, sponsor policy를 저장하고 call을 실행하기 전에 WebAuthn/P-256 execution proof를 검증합니다.

factory account parameter에는 다음이 포함됩니다.

| Parameter | 의미 |
| --- | --- |
| `recoveryId` | Pali wallet context, chain id, factory address에서 파생된 wallet-scoped recovery anchor. |
| `passkeyX`, `passkeyY` | WebAuthn credential에서 추출된 P-256 public key coordinate. |
| `credentialIdHash` | WebAuthn credential id의 hash. |
| `rpIdHash` | authenticator data의 WebAuthn RP ID hash. |
| `originHash`, `originLength` | WebAuthn client data의 extension-origin binding data. |
| `salt` | 하나의 credential이 둘 이상의 smart account를 제어할 수 있게 하는 deployment salt. |

smart account는 execution, signature validation, nonce, sponsor policy, recovery metadata read를 노출합니다. Pali는 local state loss 후 해당 metadata를 사용해 account를 재구성합니다.

## Sponsorship disabled로 생성

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

## Sponsor policy로 생성

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-required.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-required.png" alt="required sponsor policy detail이 있는 Pali passkey account creation popup" />
</a>
  <figcaption>Required sponsorship은 사용자가 승인하기 전에 sponsor URL, signer, policy text를 표시합니다.</figcaption>
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

## Recovery-before-create 동작

dapp이 passkey account를 요청하면:

1. Pali는 active chain이 passkey smart account를 지원하는지 검증합니다.
2. Pali는 passkey가 요청된 sponsor policy와 일치하는 on-chain account를 복구할 수 있는지 확인합니다.
3. 일치하는 account가 local에 있으면 Pali는 이를 재사용합니다.
4. 일치하는 account가 on-chain에는 있지만 local에는 없으면 Pali가 import합니다.
5. 같은 sponsor URL hash에 대한 account가 있지만 mode 또는 signer가 다르면 Pali는 recovery mismatch로 거부합니다.
6. 일치하는 account가 없으면 Pali는 새 account creation을 진행합니다.

## Address를 결정하는 요소

smart account address는 passkey public coordinate, credential hash, origin data, RP ID hash, recovery ID, deployment salt를 포함한 factory input에서 파생됩니다. sponsor URL text 자체는 address seed가 아니지만, sponsor policy는 institution-scoped onboarding을 위한 recovery matching logic에서 사용됩니다.

## 사용자가 local Pali data를 잃은 경우

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="passkey smart account 복구를 위한 Pali settings 화면" />
</a>
  <figcaption>Recovery 화면은 restored wallet 및 authenticator와 일치하는 on-chain passkey account를 discover합니다.</figcaption>
</figure>

browser profile, extension storage 또는 local passkey account metadata를 잃어도 chain에는 account 복구에 충분한 public metadata가 남아 있을 수 있습니다.

1. 사용자가 recovery ID의 anchor가 되는 wallet context로 Pali를 복원하거나 엽니다.
2. Pali가 사용자의 authenticator에서 discoverable WebAuthn assertion을 요청합니다.
3. Pali가 recovery ID와 credential hash로 factory registry를 query합니다.
4. Pali가 각 candidate account의 recovery metadata를 읽습니다.
5. Pali가 이미 local에 있는 account를 건너뜁니다.
6. Pali가 일치하는 account를 local wallet state로 다시 import합니다.

dapp-driven create/recover의 경우 Pali는 recovered account의 sponsor mode, signer, URL hash도 dapp이 요청한 sponsor policy와 비교합니다. 이는 기관이 dapp이 요청한 것과 다른 sponsor policy에 사용자를 조용히 binding하는 것을 방지합니다.

## RP ID 및 credential name

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser 또는 operating system passkey assertion prompt" />
</a>
  <figcaption>Recovery와 execution에는 관련 passkey credential의 WebAuthn assertion이 필요합니다.</figcaption>
</figure>

wallet path가 RP ID를 제공하지 않는 한, browser는 extension-origin WebAuthn의 effective RP ID를 제어합니다. Pali는 기본 shared credential을 `Pali Wallet Passkey`로 label하고 요청된 account label을 user-facing account association에 사용합니다.
