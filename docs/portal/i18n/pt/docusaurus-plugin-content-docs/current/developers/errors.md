---
title: Erros
---

Sempre envolva solicitações de provider em `try` / `catch`. A Pali usa erros no estilo JSON-RPC e EIP-1193 padrão quando possível, além de erros específicos da carteira para redes sem suporte, restrições de hardware wallet e estados de passkey.

```js
try {
  await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [tx],
  });
} catch (error) {
  switch (error.code) {
    case 4001:
      console.log('User rejected the request.');
      break;
    case 4100:
      console.log('The dapp is not authorized.');
      break;
    case 4200:
      console.log('The method is unsupported.');
      break;
    default:
      console.error(error);
  }
}
```

## Categorias comuns

| Código | Significado |
| --- | --- |
| `4001` | Usuário rejeitou a solicitação. |
| `4100` | Conta ou método não autorizado. |
| `4101` | O método está disponível apenas para uma família de chain diferente. |
| `4200` | Método sem suporte. |
| `4900` | Provider desconectado. |
| `4901` | Provider desconectado da chain solicitada. |
| `5730` | Id de bundle EIP-5792 desconhecido em `wallet_getCallsStatus`. |

Veja [Códigos de erro](../reference/error-codes.md) para a referência mais longa.
