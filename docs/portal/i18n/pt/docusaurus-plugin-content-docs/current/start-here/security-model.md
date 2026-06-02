---
title: Modelo de segurança
---

A Pali é uma carteira não custodial. Ela não expõe chaves privadas a dapps. Dapps enviam solicitações ao provider injetado, a Pali valida e roteia essas solicitações, e os usuários aprovam ações sensíveis na UI da extensão.

## Princípios centrais

- **Conexões por origem:** as conexões são armazenadas por host da dapp.
- **Uma conta ativa por dapp:** um site conectado tem uma conta ativa por vez, embora muitos sites possam estar conectados.
- **Aprovações serializadas:** solicitações bloqueantes que abrem popups são coordenadas para que os usuários não fiquem soterrados por aprovações concorrentes.
- **Verificações de família de rede:** métodos EVM e métodos UTXO são separados. Chamadas da família errada devem ser tratadas como erros recuperáveis da dapp.
- **Assinatura explícita:** transações, PSBTs, dados tipados, assinatura de mensagens, criação de passkey, execuções de passkey, solicitações de observação de ativos e mudanças de chain exigem o estado correto da carteira e aprovação do usuário.
- **Isolamento de provider:** a Pali injeta providers na página de nível superior. Ela não injeta em iframes.

## O que dapps recebem

Dapps recebem identificadores públicos de conta, estado do provider, assinaturas, hashes de transação e resultados RPC explícitos. Elas nunca recebem seed phrases, chaves privadas, material privado de passkey ou segredos do authenticator.

## Segurança de passkey

Smart accounts com passkey usam credenciais WebAuthn. A Pali armazena metadados públicos e identificadores de credenciais; o material de chave privada permanece dentro do authenticator. A Pali rejeita asserções WebAuthn entre origens e verifica se os hashes de ação de passkey correspondem ao conjunto de transações preparado.

## Segurança da política de sponsor

A política de sponsor institucional é dividida em:

- **Política on-chain:** modo, signer do sponsor e hash da URL.
- **Metadados da carteira:** URL do sponsor e texto de política exibido.

O campo `policyText` é mostrado aos usuários como contexto. Ele não é um primitivo de enforcement on-chain.
