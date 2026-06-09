---
title: Segurança e operações
---

Smart accounts da Pali devem ser tratadas como infraestrutura de conta. O contrato guarda ativos e os módulos instalados decidem quem pode movê-los.

## Dependências

A chain deve ter a factory e os módulos da Pali configurados. Validadores passkey também exigem verificação P-256 WebAuthn.

## Checklist operacional

- Decida qual validador controla a conta: passkey, ECDSA, composite ou recovery.
- Trate owners ECDSA externos como alto risco.
- Defina guardiões, threshold e atraso de recuperação.
- Mantenha financiada a conta que paga gas.
- Monitore implantações falhas, instalações de módulos falhas e recoveries expiradas.

## Recovery

Guardian recovery é substituição atrasada de validador. A Pali usa um salt novo por tentativa e o módulo permite apenas uma recovery ativa por conta. Não é uma backdoor custodial: requer guardiões configurados e assinaturas válidas.
