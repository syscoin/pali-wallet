---
title: 가스와 자금
---

스마트 계정 authorization과 gas payment는 별개입니다. Validator가 action을 authorize하고, funded wallet account가 network fee를 지불합니다. 현재 Pali flow는 deployment, module installation, `wallet_sendCalls`, guardian recovery에 wallet-paid gas를 사용합니다. 향후 capability가 sponsorship을 명시적으로 보고하지 않는 한 dapp은 gasless flow를 약속하지 않아야 합니다.

## Paymaster를 통한 zkSYS gas

zkTanenbaum처럼 설정된 network에서는 Pali가 eligible smart account send의 실행 비용을 Pali paymaster를 통해 zkSYS로 지불할 수 있습니다. 첫 사용 시 paymaster가 smart account의 zkSYS를 사용할 수 있도록 일회성 approval이 필요할 수 있으며, 이 setup transaction에는 여전히 native gas가 필요할 수 있습니다. zkSYS sponsorship이 optional이고 사용할 수 없거나, 사용자가 거절했거나, 요청한 operation에 안전하지 않으면 Pali는 native gas로 fallback합니다. Dapp은 이를 완전한 gasless flow가 아니라 사용 가능한 경우의 zkSYS-paid smart-account gas로 설명해야 합니다.
