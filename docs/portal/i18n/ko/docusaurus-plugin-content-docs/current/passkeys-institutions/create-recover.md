---
title: 스마트 계정 생성과 복구
---

`wallet_prepareSmartAccount`는 dapp 온보딩을 위한 Pali 스마트 계정을 만듭니다. Pali는 계정을 파생하고, 설정된 팩토리로 배포하며, 필요하면 요청된 검증기를 설치합니다. 그런 다음 요청한 dapp에 계정을 연결하고, 영구 계정 메타데이터를 로컬 지갑 상태에 기록합니다.

로컬 지갑 상태는 Pali가 사용할 수 있는 스마트 계정을 나타냅니다. 스마트 계정은 패스키 검증기, ECDSA 검증기, 복합 검증기 또는 생성 후 설치된 가디언 복구 모듈이 제어할 수 있습니다.

## 스마트 계정과 팩토리 구조

스마트 계정 시스템은 다음 요소로 구성됩니다.

- **팩토리:** 결정적 주소를 계산하고 초기 모듈 데이터로 계정을 배포합니다.
- **스마트 계정:** 호출을 실행하고 설치된 모듈을 추적하며, 검증기 모듈에 서명 승인을 요청합니다.
- **검증기:** 작업을 허가합니다. Pali는 ECDSA, P-256 WebAuthn 패스키, 복합 검증기를 지원합니다.
- **실행기:** 계정 기능을 확장합니다. Pali는 가디언 복구를 실행기 모듈로 사용합니다.

팩토리의 계정 매개변수는 다음과 같습니다.

| 매개변수 | 의미 |
| --- | --- |
| `salt` | Pali가 지갑 앵커, 계정 인덱스, 체인, 계정 버전에서 파생하는 결정적 배포 솔트입니다. |
| `initialValidator` | 부트스트랩 배포에 사용하는 검증기 모듈입니다. Pali는 결정적 설정을 위해 지갑이 소유한 ECDSA 검증기를 사용합니다. |
| `initData` | 인코딩된 검증기 초기화 데이터입니다. |

배포 후 Pali는 하나의 스마트 계정 일괄 작업으로 요청된 검증기를 설치하고 부트스트랩 검증기를 제거할 수 있습니다. 따라서 dapp이 패스키 제어 계정을 요청해도 Pali는 최초 배포 경로의 결정성을 유지할 수 있습니다.

## 패스키가 제어하는 계정 생성

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      authenticator: { id: 'p256-webauthn' },
    },
  ],
});
```

dapp이 `authenticator`를 생략하면 Pali는 기본적으로 패스키 경로를 사용합니다. `{ id: 'p256-webauthn' }`처럼 id만 포함한 요청을 사용하고, 지갑이 제어하는 자격 증명은 Pali가 선택하거나 생성하도록 하세요. 외부 ECDSA 소유자는 계속 아래의 명시적 확인 흐름을 사용합니다.

## ECDSA 스마트 계정 생성

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Team account',
      authenticator: {
        id: 'ecdsa',
        config: {
          owners: ['0xOwnerAddress'],
          threshold: 1,
        },
      },
    },
  ],
});
```

이미 로컬 Pali 지갑 계정인 ECDSA 소유자는 지갑 소유자로 취급됩니다. 외부 ECDSA 소유자 주소는 향후 스마트 계정 작업을 승인할 수 있으므로, 명시적인 경고와 확인 후에만 허용됩니다.

## 생성 및 배포 동작

dapp이 스마트 계정을 요청하면 다음과 같이 동작합니다.

1. Pali는 활성 체인에 Pali 스마트 계정 기반 컨트랙트가 설정되어 있는지 확인합니다.
2. 다음 결정적 계정 설명자와 카운터팩추얼 주소를 파생합니다.
3. 요청된 인증기를 생성하거나 정규화합니다.
4. dapp 호스트, 계정 이름, 인증기 유형, 외부 ECDSA 소유자를 표시합니다.
5. 계정을 로컬에 만들고, 부트스트랩 검증기를 사용하여 온체인에 배포합니다.
6. 요청된 검증기가 부트스트랩 검증기와 다르면, 스마트 계정 실행을 통해 요청된 검증기를 설치하고 부트스트랩 검증기를 제거합니다.
7. 확인을 기다리고, 영구 스마트 계정 메타데이터를 저장한 뒤, 계정을 dapp에 연결합니다.

생성된 주소가 이미 로컬에 있으면 Pali는 해당 로컬 스마트 계정을 재사용할 수 있습니다.

## 주소를 결정하는 요소

스마트 계정 주소는 팩토리, 계정 구현, 부트스트랩 검증기 초기화 데이터, Pali의 결정적 배포 솔트에서 파생됩니다. Pali는 지갑 앵커와 계정 인덱스에서 솔트를 파생하므로, 임의의 로컬 상태가 아니라 지갑 메타데이터를 통해 계정을 복구할 수 있습니다.

## 로컬 Pali 데이터를 잃은 경우

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="스마트 계정을 복구하는 Pali 설정 화면" />
</a>
  <figcaption>복구 화면에서는 Pali가 생성한 계정을 재구성하거나 가디언 복구로 활성 검증기를 교체하여 스마트 계정 접근을 복구할 수 있습니다.</figcaption>
</figure>

브라우저 프로필, 확장 프로그램 저장소 또는 로컬 스마트 계정 메타데이터를 잃었다면, 복구 방식은 계정의 현재 모듈에 따라 달라집니다.

- Pali가 결정적으로 생성한 계정은 지갑 앵커, 체인, 계정 인덱스, 팩토리 설정에서 재구성할 수 있습니다.
- 패스키 검증기는 향후 작업을 허가할 때 해당 WebAuthn 자격 증명을 계속 필요로 합니다.
- 원래 승인 방법을 사용할 수 없다면, 가디언 복구를 통해 설정된 지연 시간 후에 활성 검증기를 교체할 수 있습니다.

Pali 복구는 자체 관리형입니다. 서버 백도어가 아니며, 계정에 설치된 모듈을 우회할 수 없습니다.

## RP ID와 자격 증명 이름

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="브라우저 또는 운영체제의 패스키 어서션 요청 화면" />
</a>
  <figcaption>복구와 실행에는 해당 패스키 자격 증명의 WebAuthn 어서션이 필요합니다.</figcaption>
</figure>

확장 프로그램 출처의 WebAuthn에서 사용할 실제 RP ID는 지갑 흐름이 따로 지정하지 않는 한 브라우저가 결정합니다. Pali는 기본 공유 자격 증명에 `Pali Wallet Passkey`라는 이름을 붙이고, 요청된 계정 이름을 사용자에게 보여 주는 계정 연결 정보에 사용합니다.
