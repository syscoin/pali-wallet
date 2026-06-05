---
title: Passkey와 기관
---

Pali passkey smart account를 사용하면 사용자가 WebAuthn을 통해 execution을 제어하는 동안 dapp이 wallet에 account creation 또는 recovery를 요청할 수 있습니다.

이는 다음에 유용합니다.

- institutional onboarding
- sponsor-backed gas flow
- co-authorized policy
- wallet reinstall 후 account recovery
- atomic multi-call workflow
- wallet을 직접 만들지 않고 passkey UX를 원하는 dapp

## zkSYS passkey가 가능한 이유

Passkey는 WebAuthn을 사용하며, WebAuthn의 표준 signing algorithm은 ES256입니다. 이는 secp256r1이라고도 하는 P-256 curve 위의 ECDSA입니다. 일반 EVM wallet은 보통 secp256k1 EOA를 사용하므로 passkey signature는 EOA signature가 직접 아닙니다.

Pali의 passkey account는 on-chain P-256 verification을 중심으로 설계된 zkSYS smart account입니다. wallet은 WebAuthn public key coordinate, challenge, authenticator data, client data, P-256 signature를 추출하고, smart account/factory path는 그 proof를 account의 registered metadata에 대해 검증합니다. 이것이 private key를 사용자의 authenticator 내부에 유지하면서 device biometric 또는 platform passkey를 account authorization에 사용할 수 있게 하는 이유입니다.

실제 결과는 biometric login처럼 느껴지지만 chain action을 승인하는 wallet UX입니다.

1. dapp이 passkey smart account 또는 batch execution을 요청합니다.
2. Pali는 정확한 chain, account, call, nonce, deadline, sponsor policy에 대한 action hash를 준비합니다.
3. browser/OS가 사용자에게 passkey approval을 요청합니다.
4. zkSYS smart account가 execution 전에 P-256 WebAuthn proof를 on-chain으로 검증합니다.

## 지원 network

Passkey 계정은 모든 EVM chain에서 활성화되어 있지 않습니다. 설정된 passkey factory와 zkSYS P-256 verification support가 필요합니다.

| Network | Chain id | 이 Pali build에서의 status |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | 설정됨. Factory: `0x04a52bc8B5fadBfeBBAF927832d545a270cA0cAb`. |
| `zkSYS` | wallet config에서 TBD | factory address가 Pali에 설정되면 같은 passkey architecture의 production target으로 의도됨. |

설정된 factory가 없는 network에서 dapp이 `wallet_createPasskeyAccount`를 호출하면 Pali는 unsupported metadata를 생성하는 대신 요청을 거부합니다.

## Dapp method

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-disabled.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-disabled.png" alt="sponsorship disabled 상태의 Pali wallet_createPasskeyAccount popup" />
</a>
  <figcaption>기본 dapp-driven passkey flow는 기관이 명시적으로 sponsor policy를 필요로 하지 않는 한 sponsorship disabled로 시작해야 합니다.</figcaption>
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

result에는 smart account `address`와 public passkey metadata가 포함됩니다.

## Sponsor mode

| Mode | 의미 |
| --- | --- |
| `disabled` | sponsor policy 없음. wallet/user가 gas를 지불합니다. |
| `gasOnly` | Sponsor service가 gas를 지불할 수 있습니다. Pali는 이 mode에 sponsor URL을 요구합니다. sponsorship이 실패하면 wallet-gas fallback이 허용될 수 있습니다. |
| `required` | policy에 따라 sponsor co-authorization이 필요합니다. signer가 필요하며, Pali가 wallet의 local account에서 signer proof를 얻을 수 있으면 sponsor URL은 optional입니다. |

## 사용자 제어

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser 또는 operating system passkey creation sheet" />
</a>
  <figcaption>wallet review 후 browser 또는 operating system이 WebAuthn passkey creation을 처리합니다.</figcaption>
</figure>

사용자는 승인 전에 requesting site, label, sponsor mode, signer, URL, policy text를 봅니다. 그런 다음 browser 또는 OS가 WebAuthn passkey prompt를 표시합니다.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Passkey dapp onboarding flow"></video>
  <figcaption>Passkey onboarding flow: branded intro, dapp request, Pali account approval.</figcaption>
</figure>
