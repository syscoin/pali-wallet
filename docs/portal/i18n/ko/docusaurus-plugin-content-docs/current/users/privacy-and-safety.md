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
