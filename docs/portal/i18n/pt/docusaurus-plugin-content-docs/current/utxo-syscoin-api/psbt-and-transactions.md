---
title: PSBT e transações
---

Aplicações UTXO devem construir transações cuidadosamente, solicitar uma assinatura por meio da Pali e fazer broadcast apenas depois que o usuário aprovar.

## Assinar uma PSBT

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__chip">UTXO • Syscoin</p>
      <p className="pali-capture-card__title">Revisão de assinatura PSBT</p>
      <p className="pali-capture-card__subtitle">Confirmação de assinatura UTXO</p>
      <p className="pali-capture-card__hint">Role dentro da prévia para inspecionar saídas, entradas, tamanho, peso e tempo de bloqueio.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Tela de revisão de assinatura PSBT da Pali" />
    </div>
  </div>
  <figcaption>A Pali solicita confirmação do usuário antes de assinar PSBTs UTXO.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Assinar e enviar

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Buscar transações

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Validar um endereço

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Responsabilidade da dapp

A Pali assina o que o usuário aprova. Sua aplicação é responsável por construir entradas, saídas, taxas, troco e metadados de ativos de PSBT sensatos antes de solicitar uma assinatura.

## Seleção de conta

A assinatura fica vinculada à conta conectada à dapp solicitante e à rede aprovada. Os metadados de uma PSBT não podem selecionar outra conta da carteira. Se a Pali estiver exibindo uma conta diferente, poderá pedir ao usuário que mude para a conta conectada antes da aprovação. Para usar outra conta, altere a conexão da dapp e solicite uma nova aprovação.

Em uma PSBT com entradas não finalizadas, pelo menos uma entrada não finalizada deve pertencer à conta aprovada. A Pali assina apenas as entradas dessa conta. Assim, transações compartilhadas e de múltiplas assinaturas podem ser retornadas parcialmente assinadas; os outros participantes devem concluir suas próprias entradas ou assinaturas. Assinaturas externas existentes e entradas finalizadas compatíveis são preservadas. Uma PSBT totalmente finalizada pode ser retornada sem adicionar assinaturas. O suporte a carteiras de hardware ainda depende do dispositivo e do formato da transação.

Uma mudança de conta ou rede invalida o contexto de assinatura pendente. Reconstrua ou confira novamente a solicitação e obtenha uma nova aprovação em vez de repetir a solicitação antiga.
