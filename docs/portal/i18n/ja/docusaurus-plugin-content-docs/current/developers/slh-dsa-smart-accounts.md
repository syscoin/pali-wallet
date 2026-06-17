---
title: SLH-DSA スマートアカウント
---

Pali のスマートアカウントはモジュール型バリデータをサポートします。ポスト量子バリデータは、Pali が管理するローカル **SLH-DSA-SHA2-128s** 署名を使います。API 上の authenticator id は `slh-dsa` です。

:::caution アルファ注意
Pali のスマートアカウントと SLH-DSA は初期段階のインフラです。対応テストネットまたは少額アカウントから始め、復旧手段や予備バリデータを残し、dapp UX を固定の設定時間や署名時間に依存させないでください。
:::

## Dapp リクエスト

`wallet_prepareSmartAccount` でスマートアカウントをリクエストします。

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Post-quantum test account',
      authenticator: { id: 'slh-dsa' },
    },
  ],
});
```

`keyId`、`pkSeed`、`pkRoot`、その他の SLH-DSA 鍵情報を含めないでください。Pali がローカル署名者を生成し管理します。Dapp が渡した SLH-DSA 鍵は、Pali が署名できないアカウントを作らないため拒否されます。

## 署名フロー

Pali はローカル SLH-DSA 署名者でスマートアカウントの action hash に署名します。署名前に、対象アカウント、読み込まれたメタデータ、アクティブな `slh-dsa` バリデータ、公開鍵の一致、セッションによるローカル状態の復号を確認します。

確認に失敗した場合、Pali は署名せず、ローカル状態の再生成または別の承認方法を求めます。

## 制限と gas

- 鍵ごとの絶対容量: `2^24`;
- 通常署名の上限: `2^24 - 1,000`;
- ローテーション用に予約される署名: `1,000`;
- 署名長: `3,856` バイト;
- SLH-DSA `preVerificationGas`: `130,000`;
- SLH-DSA `verificationGasLimit`: 保守的な上限として `700,000`。

`signatureCount >= signatureLimit` になると、Pali はその鍵で通常操作を署名せず、明示的な `rotateValidator` 実行にだけ予約予算を許可します。Dapp は署名時間を固定値として扱わないでください。

## 参考

- [NIST FIPS 205](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579)
