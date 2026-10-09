---
title: PSBT 및 트랜잭션
---

UTXO 애플리케이션은 트랜잭션을 신중하게 구성하고 Pali를 통해 서명을 요청하며, 사용자가 승인한 뒤에만 전파해야 합니다.

## PSBT 서명

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__chip">UTXO • Syscoin</p>
      <p className="pali-capture-card__title">PSBT 서명 검토</p>
      <p className="pali-capture-card__subtitle">UTXO 서명 확인</p>
      <p className="pali-capture-card__hint">미리보기 안을 스크롤하여 출력, 입력, 크기, 가중치, 잠금 시간을 확인하세요.</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Pali PSBT 서명 검토 화면" />
    </div>
  </div>
  <figcaption>Pali는 UTXO PSBT에 서명하기 전에 사용자에게 확인을 요청합니다.</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## 서명 및 전송

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## 트랜잭션 조회

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## 주소 검증

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## dapp의 책임

Pali는 사용자가 승인한 내용에 서명합니다. 서명을 요청하기 전에 적절한 PSBT 입력, 출력, 수수료, 잔돈, 자산 메타데이터를 구성할 책임은 애플리케이션에 있습니다.

## 계정 선택

서명은 요청한 dapp에 연결된 계정과 승인된 네트워크에 묶입니다. PSBT 메타데이터로 다른 지갑 계정을 선택할 수 없습니다. Pali가 다른 계정을 표시하고 있다면 승인 전에 연결된 계정으로 전환하도록 사용자에게 요청할 수 있습니다. 다른 계정을 사용하려면 dapp 연결을 변경하고 새 승인을 요청하세요.

완료되지 않은 입력을 포함한 PSBT에서는, 완료되지 않은 입력 중 적어도 하나가 승인된 계정에 속해야 합니다. Pali는 해당 계정의 입력에만 서명합니다. 따라서 공유 트랜잭션과 다중 서명 트랜잭션은 부분 서명 상태로 반환될 수 있으며, 다른 참여자는 자신의 입력이나 서명을 완료해야 합니다. 기존 외부 서명과 지원되는 최종화된 입력은 유지됩니다. 완전히 최종화된 PSBT는 서명을 추가하지 않고 반환할 수 있습니다. 하드웨어 지갑의 지원 범위는 여전히 기기와 트랜잭션 형식에 따라 달라집니다.

계정이나 네트워크가 바뀌면 대기 중인 서명 컨텍스트는 무효화됩니다. 이전 요청을 재실행하지 말고 요청을 다시 구성하거나 확인한 뒤 새 승인을 받으세요.
