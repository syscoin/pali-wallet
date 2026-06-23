---
title: Testes com a Pali
---

Use a dapp de teste da Syscoin para testes manuais de integração e seus próprios testes automatizados para a lógica da aplicação.

## Dapp de teste hospedada

A dapp de teste da Syscoin está hospedada em:

```text
https://syscoin-test-dapp.vercel.app/
```

Ela inclui fluxos de passkey da Pali, `wallet_prepareSmartAccount`, `wallet_sendCalls`, geração de lote de allowance ERC-20 e solicitações comuns de carteira.

## Dapp de teste local

Se você precisa testar mudanças não publicadas:

```bash
git clone https://github.com/syscoin/test-dapp.git
cd test-dapp
yarn install
yarn start
```

## Extensão Pali local

```bash
git clone https://github.com/syscoin/pali-wallet.git
cd pali_wallet
yarn install
yarn dev:chrome
```

Depois carregue `build/chrome` pela página de desenvolvedor de extensões do navegador.

## Checklist de teste de passkey

1. Conecte a Pali pelo seletor de provider padrão.
2. Crie ou recupere uma conta com passkey com sponsorship desabilitado.
3. Financie ou implante a conta com passkey se exigido pelo seu teste.
4. Construa um lote ERC-20 approve mais `transferFrom`.
5. Envie o lote com `wallet_sendCalls`.
6. Confirme que a carteira mostra calldata decodificado e uma única aprovação WebAuthn para o lote de passkey.
