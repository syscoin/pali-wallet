---
title: ガスと資金
---

スマートアカウントの承認とgas支払いは別です。validatorがactionを承認し、資金のあるwallet accountがnetwork feeを支払います。現在のPali flowではdeployment、module installation、`wallet_sendCalls`、guardian recoveryにwallet-paid gasを使います。将来のcapabilityが明示しない限り、dappはgasless flowを約束しないでください。
