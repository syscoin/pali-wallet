import { sendMessage } from 'containers/auth/helpers';

export interface IConnectionsController {
  connectWallet: () => any;
  onWalletUpdate: (callback: any) => any;
  getWalletState: () => any;
  getConnectedAccount: () => any;
  handleSendToken: (sender: string, receiver: string, amount: number, fee: number, token: null, isToken: false, rbf: true) => any;
  handleSendNFT: (sender: string, receiver: string, amount: number, fee: number, token: any, isToken: true, rbf: true) => any;
  handleSendSPT: (sender: string, receiver: string, amount: number, fee: number, token: any, isToken: true, rbf: true) => any;
  isNFT: (guid: number) => boolean;
}

const isNFT = (guid: number) => {
  let assetGuid = BigInt.asUintN(64, BigInt(guid));

  return (assetGuid >> BigInt(32)) > 0
}

const ConnectionsController = (): IConnectionsController => {
  const onWalletUpdate = (onUpdated: any) => {
    window.addEventListener('message', (event) => {
      if (event.data.type === 'WALLET_UPDATED') {
        onUpdated();
      }
    });
  }

  const connectWallet = async () => {
    return await sendMessage({
      type: 'CONNECT_WALLET', 
      target: 'connectionsController',
      freeze: true,
      eventResult: 'connected'
    }, {
      type: 'CONNECT_WALLET',
      target: 'contentScript'
    });
  }

  const getWalletState = async () => {
    return await sendMessage({
      type: 'SEND_STATE_TO_PAGE', 
      target: 'connectionsController',
      freeze: true,
      eventResult: 'state'
    }, {
      type: 'SEND_STATE_TO_PAGE',
      target: 'contentScript'
    });
  }

  const getConnectedAccount = async () => {
    return await sendMessage({
      type: 'SEND_CONNECTED_ACCOUNT',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'connectedAccount'
    }, { 
      type: 'SEND_CONNECTED_ACCOUNT',
      target: 'contentScript'
    });
  }

  const handleSendToken = async (sender: string, receiver: string, amount: number, fee: number, token: any, isToken: boolean, rbf: boolean) => {
    return await sendMessage({
      type: 'SEND_TOKEN',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'complete'
    }, {
      type: 'SEND_TOKEN',
      target: 'contentScript',
      fromActiveAccountId: sender,
      toAddress: receiver,
      amount,
      fee,
      token,
      isToken,
      rbf
    });
  }

  const handleSendNFT = async (sender: string, receiver: string, amount: number, fee: number, token: any, isToken: true, rbf: true) => {
    return await sendMessage({
      type: 'SEND_NFT',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'responseSendNFT'
    }, {
      type: 'SEND_NFT',
      target: 'contentScript',
      fromActiveAccountId: sender,
      toAddress: receiver,
      amount,
      fee,
      token,
      isToken,
      rbf
    });
  }

  const handleSendSPT = async (sender: string, receiver: string, amount: number, fee: number, token: any, isToken: true, rbf: true) => {
    return await sendMessage({
      type: 'SEND_SPT',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'responseSendSPT'
    }, {
      type: 'SEND_SPT',
      target: 'contentScript',
      fromActiveAccountId: sender,
      toAddress: receiver,
      amount,
      fee,
      token,
      isToken,
      rbf
    });
  }

  return {
    isNFT,
    connectWallet,
    onWalletUpdate,
    getWalletState,
    getConnectedAccount,
    handleSendToken,
    handleSendNFT,
    handleSendSPT
  }
};

export default ConnectionsController;