---
title: 개인정보 및 안전
---

Pali는 명시적인 사용자 작업 없이 dapp이 알 수 있는 정보를 최소화하도록 설계되었습니다.

## Pali가 노출하지 않는 것

Pali는 seed phrase, private key, passkey private material, wallet password 또는 제한 없는 account list를 web page에 노출하지 않습니다.

## dapp이 요청할 수 있는 것

dapp은 public account address, provider state, network state, signature, transaction approval, PSBT signing, asset watch approval, chain switching, smart account creation, batch execution을 요청할 수 있습니다.

## 연결 안전

신뢰하는 dapp에만 연결하세요. 연결된 dapp은 해당 origin에 대해 승인한 계정을 볼 수 있고 향후 action을 요청할 수 있습니다. wallet에서 site access를 revoke할 수 있습니다.

## 공개 blockchain data

Blockchain activity는 공개됩니다. address, transaction history, token approval, UTXO activity, smart account deployment, Pali smart account activity가 explorer와 indexer에 표시될 수 있습니다.

## 네트워크 서비스 제공자

선택한 RPC 및 Blockbook 제공자는 작업에 필요한 계정 주소와 트랜잭션 조회 또는 전송을 받습니다. UTXO 계정 조회에는 확장 공개 키(xpub)가 포함될 수 있습니다. 토큰 검색, 탐색기, 가격, 네트워크 검색 및 하드웨어 지원 서비스에도 작업에 따라 요청이 전달됩니다. 이러한 서비스는 IP 주소와 요청 시각도 볼 수 있습니다. 연결된 dapp은 사용자가 승인한 공개 계정과 허용한 서명을 받습니다.

## 비공개 노트

이 기능은 Ethereum 메인넷의 고정된 Tornado Classic ETH 풀 4개(0.1, 1, 10, 100 ETH)를 사용하며 일반 지갑 활동을 비공개로 만들지는 않습니다. 입금과 직접 출금에는 서명 가능한 소프트웨어 HD 계정 또는 가져온 계정이 필요합니다. 가져온 관찰 전용 계정은 릴레이어 출금의 컨텍스트를 제공할 수 있지만, 하드웨어 및 스마트 계정은 이러한 작업을 지원하지 않습니다. 직접 출금은 가스 지불자와 수신자를 공개적으로 연결합니다. 릴레이어에는 별도의 수수료와 신뢰 위험이 있습니다. 익명성이나 양자 이후 프라이버시는 보장되지 않습니다.

비공개 노트는 소지자가 사용할 수 있는 비밀이므로 누구든 노트를 가지면 출금할 수 있습니다. 지갑이 잠금 해제되어 있고 비밀번호를 아는 동안 저장된 각 노트에서 **백업용으로 표시**를 선택하고 백업을 안전하고 비밀스럽게 보관하세요. 복구, 초기화 또는 다른 설치 환경으로 이동한 뒤 복구 구문만으로 생성된 노트를 복원할 수 없습니다.

프라이버시 서비스는 공개 풀 데이터와 릴레이어 목록을 제공하며, 선택한 Ethereum RPC 및 선택한 릴레이어의 엔드포인트와는 별개입니다. 기본 서비스는 `https://sysnode.info`입니다. 설정에는 경로, 자격 증명, 쿼리 또는 프래그먼트가 없는 HTTPS 오리진이나 `localhost` 또는 `127.0.0.1`의 HTTP를 사용합니다. 서비스를 바꾸면 준비된 공개 풀 데이터가 지워져 다시 준비해야 하지만 저장된 노트는 유지됩니다. 제공자는 IP 주소와 요청 시각을 볼 수 있습니다.

Pali는 기본 프라이버시 서비스 또는 직접 운영하는 Sysnode 서비스를 사용할 수 있습니다. 직접 서비스를 실행하려면 [Sysnode 가이드](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md)를 참조하세요.

기본 한도는 저장된 노트 128개(최대 4 MiB)입니다. **노트 용량**에서 256개(최대 8 MiB) 또는 512개(최대 16 MiB)를 선택할 수 있습니다. 한도가 높으면 로컬 저장 공간을 더 사용하고 보관함 작업이 느려질 수 있습니다. 한도를 바꿔도 노트는 삭제되지 않지만 이전 지갑 버전에서는 변경된 보관함 형식을 읽지 못할 수 있습니다.

**완료된 노트 지우기**로 완료된 노트를 검증하고 삭제할 수 있습니다. 알려진 출금과 기록된 관련 입금이 있다면 그 입금도 최종 확정되어야 하며, 검증되지 않은 노트는 보관됩니다. 선택한 Ethereum RPC에 출금 트랜잭션 해시와 관련 입금 해시가 있으면 그 해시도 전송되므로 제공자가 둘을 연결할 수 있습니다. 검증은 해당 RPC의 응답에 의존합니다.

저장된 노트 수보다 낮은 한도로 줄일 수 없습니다. 사용됨으로 표시된 노트라도 삭제에 필요한 로컬 출금 기록과 트랜잭션 해시가 없으면 계속 저장됩니다. 노트는 하나씩 확인하므로 중단되기 전에 일부 삭제가 이미 완료되었을 수 있습니다. 오류 후 다시 시도하기 전에 목록을 새로고침하세요.

## 스마트 계정 개인정보

스마트 계정 모듈과 실행은 온체인에서 공개됩니다. dapp이 ECDSA 소유자나 복구 모듈 설치를 요청하면 승인하기 전에 소유자 주소와 복구 설정을 확인하세요.
