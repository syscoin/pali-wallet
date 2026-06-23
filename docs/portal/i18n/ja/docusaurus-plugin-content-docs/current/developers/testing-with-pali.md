---
title: Paliでのテスト
---

手動の統合テストにはSyscoinテストdappを使用し、アプリケーションロジックには独自の自動テストを使用してください。

## ホスト済みテストdapp

Syscoinテストdappは次の場所でホストされています。

```text
https://syscoin-test-dapp.vercel.app/
```

Pali passkeyフロー、`wallet_prepareSmartAccount`、`wallet_sendCalls`、ERC-20 allowanceバッチ生成、一般的なウォレットリクエストが含まれています。

## ローカルテストdapp

未公開の変更をテストする必要がある場合:

```bash
git clone https://github.com/syscoin/test-dapp.git
cd test-dapp
yarn install
yarn start
```

## ローカルPali拡張機能

```bash
git clone https://github.com/syscoin/pali-wallet.git
cd pali_wallet
yarn install
yarn dev:chrome
```

その後、ブラウザ拡張機能の開発者ページから`build/chrome`を読み込みます。

## Passkeyテストチェックリスト

1. デフォルトのプロバイダーセレクターからPaliに接続します。
2. スポンサーシップを無効にしてpasskeyアカウントを作成し、Paliがデプロイ確認を完了するまで待ちます。
3. テストで必要な場合、passkeyアカウントへ資金を入れるかデプロイします。
4. ERC-20 approveと`transferFrom`のバッチを作成します。
5. `wallet_sendCalls`でバッチを送信します。
6. ウォレットがデコード済みcalldataと、passkeyバッチ用の単一のWebAuthn承認を表示することを確認します。
