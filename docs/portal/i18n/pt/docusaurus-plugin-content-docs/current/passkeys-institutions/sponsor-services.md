---
title: Gas e financiamento
---

A autorização de uma smart account e o pagamento de gas são separados. Um passkey ou validador autoriza a ação; uma conta financiada paga a taxa de rede.

## Modelo atual

O fluxo atual usa gas pago pela carteira: implantação, instalação de módulos, `wallet_sendCalls` e guardian recovery são enviados por uma conta local financiada. Não anuncie uma experiência gasless a menos que uma capability futura indique patrocínio explicitamente.

## Orientação para dapps

Explique que a Pali criará uma smart account, que o usuário aprovará a ação e que pode precisar de native token para implantação ou recuperação. Não envie objetos legacy de patrocínio para `wallet_prepareSmartAccount`; a solicitação atual usa label e configuração de authenticator/módulos.
