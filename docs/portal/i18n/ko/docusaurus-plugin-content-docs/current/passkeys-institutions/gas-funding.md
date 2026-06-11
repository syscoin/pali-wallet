---
title: 가스와 자금
---

스마트 계정 authorization과 gas payment는 별개입니다. Validator가 action을 authorize하고, funded wallet account가 network fee를 지불합니다. 현재 Pali flow는 deployment, module installation, `wallet_sendCalls`, guardian recovery에 wallet-paid gas를 사용합니다. 향후 capability가 sponsorship을 명시적으로 보고하지 않는 한 dapp은 gasless flow를 약속하지 않아야 합니다.
