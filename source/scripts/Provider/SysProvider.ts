import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import store from 'state/store';

export const SysProvider = (host: string) => {
  const txs = window.controller.wallet.account.sys.tx;

  const getAccount = () => {
    const account = window.controller.dapp.getAccount(host);
    if (!account) throw new Error('No connected account');

    return account;
  };

  const getNetwork = () => store.getState().vault.activeNetwork;

  const estimateFee = () => txs.getRecommendedFee(getNetwork().url);

  const sendTransaction = (tx: {
    amount: number;
    fee: number;
    receivingAddress: string;
  }) =>
    popupPromise({
      host,
      route: 'tx/send/confirm',
      data: tx,
      eventName: 'txSend',
    });

  const mintToken = (tx: { amount: number; assetGuid: string; fee: number }) =>
    popupPromise({
      host,
      route: 'tx/asset/issue',
      data: tx,
      eventName: 'txMintToken',
    });

  return {
    getAccount: () => getAccount(),
    getAddress: () => getAccount().address,
    getBalance: () => getAccount().balances.syscoin,
    getPublicKey: () => getAccount().xpub,
    getTokens: () => getAccount().assets,
    estimateFee,
    sendTransaction,
    mintToken,
  };
};
