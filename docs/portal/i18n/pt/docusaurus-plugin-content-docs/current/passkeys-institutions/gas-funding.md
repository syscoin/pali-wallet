---
title: Gas e financiamento
---

A autorização de uma smart account e o pagamento de gas são separados. Um passkey ou validador autoriza a ação; uma conta financiada paga a taxa de rede.

## Modelo atual

O fluxo atual usa gas pago pela carteira: implantação, instalação de módulos, `wallet_sendCalls` e guardian recovery são enviados por uma conta local financiada. Não anuncie uma experiência gasless a menos que uma capability futura indique patrocínio explicitamente.

## Gas zkSYS via paymaster

Em redes configuradas como zkTanenbaum, a Pali pode pagar envios elegíveis de smart account em zkSYS por meio de um paymaster da Pali. O primeiro uso pode exigir uma aprovação única de zkSYS; essa transação de configuração ainda pode precisar de gas nativo. Se o patrocínio com zkSYS for opcional e estiver indisponível, for recusado ou não for seguro para a operação solicitada, a Pali volta para gas nativo. Dapps devem descrever isso como gas de smart account pago em zkSYS quando disponível, não como um fluxo totalmente gasless.

## Orientação para dapps

Explique que a Pali criará uma smart account, que o usuário aprovará a ação e que pode precisar de native token para implantação ou recuperação. Não envie objetos legacy de patrocínio para `wallet_prepareSmartAccount`; a solicitação atual usa label e configuração de authenticator/módulos.
