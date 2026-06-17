---
title: SLH-DSA 스마트 계정
---

Pali 스마트 계정은 모듈형 검증자를 지원합니다. 포스트 양자 검증자는 Pali가 관리하는 로컬 **SLH-DSA-SHA2-128s** 서명을 사용합니다. API에서 authenticator id는 `slh-dsa`입니다.

:::caution 알파 안내
Pali 스마트 계정과 SLH-DSA는 초기 단계의 인프라입니다. 지원되는 테스트넷이나 소액 계정부터 사용하고, 복구 경로나 대체 검증자를 유지하며, dapp UX를 고정된 설정 또는 서명 시간에 의존하게 만들지 마세요.
:::

## Dapp 요청

`wallet_prepareSmartAccount`로 스마트 계정을 요청합니다.

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Post-quantum test account',
      authenticator: { id: 'slh-dsa' },
    },
  ],
});
```

`keyId`, `pkSeed`, `pkRoot` 또는 다른 SLH-DSA 키 자료를 포함하지 마세요. Pali가 로컬 서명자를 생성하고 관리합니다. Dapp이 제공한 SLH-DSA 키는 Pali가 서명할 수 없는 계정을 만들지 않기 위해 거부됩니다.

## 서명 흐름

Pali는 로컬 SLH-DSA 서명자로 스마트 계정 action hash에 서명합니다. 서명 전에 대상 계정, 로드된 메타데이터, 활성 `slh-dsa` 검증자, 공개키 일치, 세션의 로컬 상태 복호화 가능 여부를 확인합니다.

확인에 실패하면 Pali는 서명하지 않고 로컬 상태 재생성 또는 다른 승인 방법을 요구합니다.

## 제한과 gas

- 키당 절대 용량: `2^24`;
- 일반 서명 한도: `2^24 - 1,000`;
- 교체용 예약 서명: `1,000`;
- 서명 길이: `3,856` 바이트;
- SLH-DSA `preVerificationGas`: `130,000`;
- SLH-DSA `verificationGasLimit`: 보수적 상한 `700,000`.

`signatureCount >= signatureLimit`가 되면 Pali는 해당 키로 일반 작업에 서명하지 않고 명시적인 `rotateValidator` 실행에만 예약 예산을 허용합니다. Dapp은 서명 시간이 고정되어 있다고 가정하면 안 됩니다.

## 참고 자료

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
