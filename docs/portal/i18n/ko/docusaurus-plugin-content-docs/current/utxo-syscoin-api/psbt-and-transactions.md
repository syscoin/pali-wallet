---
title: PSBT 및 transaction
---

UTXO application은 transaction을 신중하게 구성하고, Pali를 통해 signature를 요청하며, 사용자가 승인한 뒤에만 broadcast해야 합니다.

## PSBT 서명

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__title">PSBT 서명 검토</p>
      <p className="pali-capture-card__subtitle">고급 트랜잭션 세부 정보가 포함된 UTXO 서명 확인입니다.</p>
      <p className="pali-capture-card__hint">미리보기 안에서 스크롤하여 outputs, inputs, size, weight, lock time을 확인하세요.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Pali PSBT signing review 화면" />
    </div>
  </div>
  <figcaption>Pali는 UTXO PSBT에 서명하기 전에 사용자에게 prompt합니다.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## Sign and send

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## Transaction 가져오기

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## Address 검증

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## Dapp 책임

Pali는 사용자가 승인한 것에 서명합니다. 애플리케이션은 signature를 요청하기 전에 sane PSBT input, output, fee, change, asset metadata를 구성할 책임이 있습니다.

