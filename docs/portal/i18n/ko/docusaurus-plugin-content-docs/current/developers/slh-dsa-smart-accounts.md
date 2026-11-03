---
title: SLH-DSA 스마트 계정
---

Pali 스마트 계정은 모듈형 검증자를 지원합니다. 포스트 양자 검증자는 Pali가 관리하는 로컬 **SLH-DSA-SHA2-128-24** 서명을 사용합니다. API에서 authenticator id는 `slh-dsa`입니다.

로컬 서명자는 **SLH-DSA-SHA2-128-24**를 사용합니다. 이는 [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd) 초기 초안에서 제안된 서명 횟수 제한이 있는 실험적 프로필이며, FIPS 205에서 일반 용도로 승인된 매개변수 세트가 아닙니다. `2^24`회 제한은 키의 전체 수명에 적용되며 해당 키의 모든 사용과 복사본을 합산합니다. Pali는 교체에 `1,000`회를 예약하고 로컬에 기록된 횟수가 `2^24 - 1,000`에 이르면 일반 서명을 중지합니다. 재생성은 로컬에 남은 사용 기록을 보존하지만 시드 문구만 사용하거나 오래된 백업으로 복원하면 누락된 기록은 복구되지 않으며 기기 간 카운터도 동기화되지 않습니다. 따라서 이런 경우 전체 제한은 보장되지 않습니다.

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
