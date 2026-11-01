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

## 기관 passkey 개인정보

dapp 또는 기관이 sponsor URL을 제공하는 경우, 해당 service는 account execution과 관련된 sponsor request를 받을 수 있습니다. 승인하기 전에 institution policy text와 URL을 검토하세요.

## 비공개 노트

Pali는 기본 프라이버시 서비스 또는 직접 운영하는 Sysnode 서비스를 사용할 수 있습니다. 직접 서비스를 실행하려면 [Sysnode 가이드](https://github.com/syscoin/sysnode-backend/blob/main/docs/privacy-standalone.md)를 참조하세요.

기본 한도는 저장된 노트 128개(최대 4 MiB)입니다. **노트 용량**에서 256개(최대 8 MiB) 또는 512개(최대 16 MiB)를 선택할 수 있습니다. 한도가 높으면 로컬 저장 공간을 더 사용하고 보관함 작업이 느려질 수 있습니다. 한도를 바꿔도 노트는 삭제되지 않지만 이전 지갑 버전에서는 변경된 보관함 형식을 읽지 못할 수 있습니다.

**완료된 노트 지우기**로 완료된 노트를 검증하고 삭제할 수 있습니다. 알려진 출금과 기록된 관련 입금이 있다면 그 입금도 최종 확정되어야 하며, 검증되지 않은 노트는 보관됩니다. 선택한 Ethereum RPC에 출금 트랜잭션 해시와 관련 입금 해시가 있으면 그 해시도 전송되므로 제공자가 둘을 연결할 수 있습니다. 검증은 해당 RPC의 응답에 의존합니다.
