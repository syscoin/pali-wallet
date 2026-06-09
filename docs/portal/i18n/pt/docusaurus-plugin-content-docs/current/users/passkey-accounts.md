---
title: Smart accounts e passkeys
---

Smart accounts da Pali são contas EVM de contrato controladas por módulos. Um passkey é uma forma suportada de controlá-las; elas também podem usar ECDSA ou políticas compostas.

## Por que usar

- Aprovações com passkey para uso diário.
- Owners ECDSA quando uma carteira ou equipe deve controlar a conta.
- Validadores composite para cogestão.
- Ações em lote e guardian recovery.

## Implantação

A Pali deriva o endereço de forma determinística, implanta pela factory e salva metadados duráveis. A implantação começa com um bootstrap validator ECDSA da carteira; depois a Pali instala o validador solicitado se ele for diferente.

## Guardian recovery

Guardian recovery não é instantânea. Um guardião assina uma intenção, o módulo a agenda com atraso, e depois qualquer pessoa pode finalizar a substituição do validador. A Pali usa um salt novo por tentativa e permite apenas uma recovery ativa por conta.
