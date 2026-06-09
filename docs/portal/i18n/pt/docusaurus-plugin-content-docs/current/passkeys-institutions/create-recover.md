---
title: Criar e recuperar smart accounts
---

`wallet_prepareSmartAccount` cria uma smart account da Pali para onboarding por dapp. A Pali deriva a conta, implanta pela factory configurada, instala o validador solicitado quando necessário, conecta a conta à dapp e salva metadados duráveis localmente.

## Estrutura

- **Factory:** calcula endereços determinísticos e implanta contas.
- **Smart account:** executa chamadas e consulta validadores instalados.
- **Validadores:** ECDSA, P-256 WebAuthn passkey e composite.
- **Executores:** guardian recovery para recuperação com atraso.

## Criar com passkey

```js
await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Pali Wallet Passkey', authenticator: { id: 'p256-webauthn' } }],
});
```

## Criar com ECDSA

```js
await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Team account', authenticator: { id: 'ecdsa', config: { owners: ['0xOwnerAddress'], threshold: 1 } } }],
});
```

Owners ECDSA locais são tratados como controlados pela carteira. Owners externos exigem aviso e confirmação explícita.

## Recuperação

A recuperação depende dos módulos instalados. Contas determinísticas podem ser reconstruídas pelo anchor da carteira, chain, índice e factory. Validadores passkey exigem a credencial WebAuthn relevante. Guardian recovery pode substituir o validador ativo depois do atraso configurado.
