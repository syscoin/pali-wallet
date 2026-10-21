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

A Pali atualmente coleta aprovações de validadores filhos integrados disponíveis localmente até atingir o limite. Esta versão não oferece suporte a compostos aninhados nem à coleta de aprovações externas ou entre dispositivos. A recuperação com guardiões permanece independente da política do validador ativo.

Ao desenhar uma política composta, documente a justificativa do threshold: 1-of-N otimiza disponibilidade, N-of-N otimiza garantia e t-of-N equilibra os dois. Validadores são módulos substituíveis, então a política (e até o esquema de assinatura — incluindo futuros validadores pós-quânticos) pode ser atualizada depois sem mudar o endereço da conta. Guardiões são um módulo com papel de executor e permanecem independentes de qualquer que seja a política de validador ativa.

## Recovery

O fluxo guiado de recuperação com guardiões da Pali substitui o validador ativo após uma espera. O método anterior permanece ativo até a conclusão confirmada. Porém, o executor on-chain pode executar ações da conta aprovadas pelos guardiões e não se limita à troca de validador da interface; hooks instalados podem impor restrições adicionais. Um limite de guardiões comprometido ameaça o controle e os fundos. O módulo instalado exige aprovações válidas; a Pali usa um salt novo por tentativa e o contrato permite apenas um processo ativo não expirado por conta.

:::tip Guia atual de recuperação com guardiões

O [guia completo](../users/smart-account-validators#guardian-recovery-guide) explica configuração, início, conclusão e **Disable guardian recovery**. Novas políticas oferecem espera de 3 ou 7 dias; 10 minutos é restrito a testnets conhecidas. A desativação confirmada exige o método de aprovação atual e gas, invalida recuperações pendentes e remove essa via de recuperação, mas não desfaz uma recuperação concluída. Se uma transação for incerta, confira primeiro o estado on-chain. Alertas opcionais do Sysnode exigem e-mail verificado e assinatura da carteira; não recebem chaves nem garantem a entrega.

:::
