---
title: Serviços de sponsor
---

Um serviço de sponsor é um endpoint controlado por instituição que participa da política de execução de smart account com passkey.

## Objeto sponsor

<figure>
  <a className="pali-media-link" href="/img/screens/sponsor-pending-success.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/sponsor-pending-success.png" alt="Estados pendente e sucesso de relay de sponsor na Pali" />
</a>
  <figcaption>Execução patrocinada deve deixar claros para os usuários os estados pendente, sucesso e falha.</figcaption>
</figure>

```js
{
  mode: 'required',
  url: 'https://institution.example/sponsor/user-123',
  signer: '0xSponsorSignerAddress',
  policyText: 'Institution co-authorization is required.'
}
```

## Significado dos campos

| Campo | Propósito |
| --- | --- |
| `mode` | `disabled`, `gasOnly` ou `required`. |
| `url` | Endpoint de serviço opcional que a Pali contata para suporte à execução por sponsor. A Pali exige isso para sponsorship `gasOnly`, porque não há sponsor remoto de gas sem uma URL de serviço. |
| `signer` | Endereço esperado do signer do sponsor para provas de política obrigatória. Obrigatório para modo `required`. |
| `policyText` | Explicação voltada ao usuário armazenada nos metadados da carteira. Não é enforcement on-chain. |

## Política on-chain

A política da smart account armazena modo, signer e uma URL pública do sponsor. O texto de política é metadado da carteira usado para exibição.

## Idempotência

Solicitações de execução de sponsor usam uma chave de idempotência derivada do hash de ação de passkey. Um serviço de sponsor deve tratar solicitações repetidas com a mesma chave como a mesma ação.

## Modo de sponsor obrigatório

No modo `required`, a prova do sponsor deve recuperar para o signer configurado. A URL de sponsor é opcional: a Pali pode obter a prova do serviço de sponsor quando uma URL está configurada, ou assinar localmente quando o signer configurado é uma conta disponível na carteira. Se a Pali não conseguir obter ou validar a prova do sponsor, a execução falha.

O pagamento de gas é separado da autorização do sponsor. Depois que uma prova de sponsor válida estiver disponível, a Pali ainda pode pagar gas a partir de qualquer conta de software financiada selecionada para execução passkey.

## Modo somente gas

No modo `gasOnly`, o serviço de sponsor pode fazer relay ou ajudar a pagar gas. A Pali exige uma URL de sponsor para este modo porque a URL identifica o serviço de sponsorship de gas. Se sponsorship estiver indisponível, a Pali pode fazer fallback para execução com gas da carteira quando a política permite.

## Orientação institucional

- Use URLs de sponsor estáveis por usuário.
- Mantenha chaves de signer na infraestrutura institucional, não no frontend da dapp.
- Faça o texto de política ser curto, específico e compreensível.
- Retorne status consistente para chaves de idempotência repetidas.
- Monitore solicitações de sponsor com falha e deadlines de execução expirados.
