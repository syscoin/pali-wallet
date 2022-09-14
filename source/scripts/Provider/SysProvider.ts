import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import store from 'state/store';

export const SysProvider = (host: string) => {
  const txs = window.controller.wallet.account.sys.tx;

  const getAccount = () => {
    const account = window.controller.dapp.getAccount(host);
    if (!account) throw new Error('No connected account');

    const _account = { ...account };
    delete _account.xprv;

    return _account;
  };

  const getNetwork = () => store.getState().vault.activeNetwork;

  const estimateFee = () => txs.getRecommendedFee(getNetwork().url);

  const send = (data: {
    amount: number;
    fee: number;
    receivingAddress: string;
    tokenGuid?: string;
  }) =>
    popupPromise({
      host,
      data: { isToken: data.tokenGuid !== undefined, ...data },
      route: 'tx/send',
      eventName: 'txSend',
    });

  //* ----- Token -----
  const createToken = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/create',
      eventName: 'txCreateToken',
    });

  const updateToken = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/update',
      eventName: 'txUpdateToken',
    });

  const mintToken = (data: {
    amount: number;
    assetGuid: string;
    fee: number;
  }) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/mint',
      eventName: 'txMintToken',
    });

  //* ----- NFT -----
  const createNft = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/nft/create',
      eventName: 'txCreateNFT',
    });

  const mintNft = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/asset/nft/mint',
      eventName: 'txMintNFT',
    });

  //* ----- Sign -----
  const sign = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/sign-psbt',
      eventName: 'txSign',
    });

  const signAndSend = (data) =>
    popupPromise({
      host,
      data,
      route: 'tx/sign',
      eventName: 'txSignAndSend',
    });

  return {
    getAccount: () => getAccount(),
    getAddress: () => getAccount().address,
    getBalance: () => getAccount().balances.syscoin,
    getPublicKey: () => getAccount().xpub,
    getTokens: () => getAccount().assets,
    getNetwork,
    estimateFee,
    send,
    createToken,
    updateToken,
    mintToken,
    createNft,
    mintNft,
    sign,
    signAndSend,
  };
};
