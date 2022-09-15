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
  }) => {
    const parsedData = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
    return popupPromise({
      host,
      data: { isToken: parsedData.tokenGuid !== undefined, ...parsedData },
      route: 'tx/send',
      eventName: 'txSend',
    });
  };

  //* ----- Token -----
  const createToken = (data) => {
    const parsedData = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
    return popupPromise({
      host,
      data: parsedData,
      route: 'tx/asset/create',
      eventName: 'txCreateToken',
    });
  };

  const updateToken = (data) => {
    const parsedData = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
    return popupPromise({
      host,
      data: parsedData,
      route: 'tx/asset/update',
      eventName: 'txUpdateToken',
    });
  };

  const mintToken = (data: {
    amount: number;
    assetGuid: string;
    fee: number;
  }) => {
    const parsedData = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
    return popupPromise({
      host,
      data: parsedData,
      route: 'tx/asset/mint',
      eventName: 'txMintToken',
    });
  };

  //* ----- NFT -----
  const createNft = (data) => {
    const parsedData = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
    return popupPromise({
      host,
      data: parsedData,
      route: 'tx/asset/nft/create',
      eventName: 'txCreateNFT',
    });
  };

  const mintNft = (data) => {
    const parsedData = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
    return popupPromise({
      host,
      data: parsedData,
      route: 'tx/asset/nft/mint',
      eventName: 'txMintNFT',
    });
  };

  //* ----- Sign -----
  const sign = (data) => {
    const parsedData = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
    return popupPromise({
      host,
      data: parsedData,
      route: 'tx/sign-psbt',
      eventName: 'txSign',
    });
  };

  const signAndSend = (data) => {
    const parsedData = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));
    return popupPromise({
      host,
      data: parsedData,
      route: 'tx/sign',
      eventName: 'txSignAndSend',
    });
  };

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
