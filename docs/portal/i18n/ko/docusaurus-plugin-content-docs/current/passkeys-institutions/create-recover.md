---
title: Passkey 계정 생성 및 복구
---

`wallet_createPasskeyAccount`는 dapp onboarding을 위한 새 passkey smart account를 생성합니다. Pali는 WebAuthn credential을 생성하거나 선택하고, smart account를 on-chain에 deploy하고, deploy된 recovery metadata를 확인한 뒤 confirmation 후 account를 local wallet state에 기록합니다.

Local wallet state는 deploy된 passkey account를 나타냅니다. 이미 on-chain에 존재하는 account는 Pali settings에서 recovery할 수 있습니다.

## Smart account 및 factory 구조

passkey system에는 두 개의 on-chain 구성 요소가 있습니다.

- **Factory:** account를 만들고, counterfactual address를 계산하며, recovery lookup을 노출하고, 첫 action을 deploy와 함께 execute할 수 있습니다.
- **Smart account:** recovery metadata, nonce, sponsor policy를 저장하고 call을 실행하기 전에 WebAuthn/P-256 execution proof를 검증합니다.

factory account parameter에는 다음이 포함됩니다.

| Parameter | 의미 |
| --- | --- |
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

## Creation 및 deployment 동작

dapp이 passkey account를 요청하면:

1. Pali는 active chain이 passkey smart account를 지원하는지 검증합니다.
2. Pali는 새 account path를 위한 fresh deployment salt를 생성합니다.
3. Pali는 WebAuthn credential profile을 가져오거나 생성합니다.
4. Pali는 counterfactual address와 deployment metadata를 계산합니다.
5. 요청된 sponsor policy에 initial `setSponsor` action이 필요하면 Pali는 deployment action hash에 대한 passkey assertion을 사용자에게 요청합니다.
6. Pali는 구성된 deployment gas payer를 통해 `createAccount` 또는 `createAccountAndExecute`를 제출합니다.
7. Pali는 confirmation을 기다리고, chain에서 smart account recovery metadata를 읽은 뒤 준비된 credential 및 origin data와 일치하는지 검증합니다.
8. Confirmation 후 Pali는 local passkey account를 만들고 요청 dapp에 연결합니다.

결과 address가 deploy된 passkey account로 local에 이미 있으면 Pali는 해당 local account를 재사용할 수 있습니다.

## Address를 결정하는 요소

smart account address는 passkey public coordinate, credential hash, origin data, RP ID hash, deployment salt를 포함한 factory input에서 파생됩니다. 각 새 account path는 fresh deployment salt를 사용하므로 하나의 credential이 여러 smart account를 제어할 수 있습니다.

## 사용자가 local Pali data를 잃은 경우

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="passkey smart account 복구를 위한 Pali settings 화면" />
</a>
  <figcaption>Recovery 화면은 선택된 authenticator credential과 일치하는 on-chain passkey account를 discover합니다.</figcaption>
</figure>

browser profile, extension storage 또는 local passkey account metadata를 잃어도 chain에는 account 복구에 충분한 public metadata가 남아 있을 수 있습니다.

1. Pali가 사용자의 authenticator에서 discoverable WebAuthn assertion을 요청합니다.
2. Pali가 credential hash로 factory registry를 query합니다.
3. Pali가 각 candidate account의 recovery metadata를 읽습니다.
4. Pali가 이미 local에 있는 account를 건너뜁니다.
5. Pali가 일치하는 account를 local wallet state로 다시 import합니다.

Settings recovery는 deploy된 account를 discover하고 registry가 해당 credential에 대해 노출하는 모든 matching account를 import합니다.

## RP ID 및 credential name

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser 또는 operating system passkey assertion prompt" />
</a>
  <figcaption>Recovery와 execution에는 관련 passkey credential의 WebAuthn assertion이 필요합니다.</figcaption>
</figure>

wallet path가 RP ID를 제공하지 않는 한, browser는 extension-origin WebAuthn의 effective RP ID를 제어합니다. Pali는 기본 shared credential을 `Pali Wallet Passkey`로 label하고 요청된 account label을 user-facing account association에 사용합니다.
