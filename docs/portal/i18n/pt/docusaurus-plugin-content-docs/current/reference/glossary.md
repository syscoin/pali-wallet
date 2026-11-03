---
title: Glossário
---

## Família de conta

O modelo de conta da carteira usado por uma rede. Contas EVM são baseadas em contas. Contas Syscoin UTXO e no estilo Bitcoin são baseadas em UTXO.

## EIP-1193

A interface padrão de provider JavaScript usada por carteiras Ethereum por meio de `provider.request()`.

## EIP-6963

Um padrão de descoberta multi-carteira que permite que dapps descubram providers sem depender apenas de `window.ethereum`.

## Smart account com passkey

Uma smart account EVM controlada por uma credencial WebAuthn em vez de uma chave privada EOA normal.

## PSBT

Partially Signed Bitcoin Transaction. Um formato comum para coordenar assinatura de transações UTXO.

## Serviço de sponsor

Um serviço operado por instituição que pode fornecer sponsorship de gas, suporte de relay ou coautorização obrigatória para execução de smart account com passkey.

## SPT

Syscoin Platform Token, um ativo no lado Syscoin UTXO.

## UTXO

Unspent Transaction Output. O modelo de conta usado por chains semelhantes ao Bitcoin e por Syscoin UTXO.

## WebAuthn

O padrão de navegador por trás das passkeys. Ele permite que usuários aprovem ações criptográficas por meio de authenticators de plataforma, chaves de hardware ou provedores de passkey sincronizada.

## SLH-DSA

O assinador local usa **SLH-DSA-SHA2-128-24**, um perfil experimental de assinaturas limitadas proposto no rascunho inicial [NIST SP 800-230](https://csrc.nist.gov/pubs/sp/800/230/ipd). Ele não é um conjunto de parâmetros de uso geral aprovado no FIPS 205. Em redes configuradas, a Pali suporta ECDSA, passkeys P-256 WebAuthn, SLH-DSA e validadores compostos; os módulos compatíveis devem estar implantados e as chaves ou credenciais locais necessárias devem estar disponíveis.
