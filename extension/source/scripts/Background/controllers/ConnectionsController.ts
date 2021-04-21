import { sendMessage } from 'containers/auth/helpers';

export interface IConnectionsController {
  connectWallet: () => any;
  onWalletUpdate: (callback: any) => any;
  getWalletState: () => any;
  getConnectedAccount: () => any;
  transferSYS: (sender: string, receiver: string, amount: number, fee: number) => any;
  handleSendNFT: () => any;
  handleSendSPT: () => any;
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

  const transferSYS = async (sender: string, receiver: string, amount: number, fee: number) => {
    return await sendMessage({
      type: 'TRANSFER_SYS',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'complete'
    }, {
      type: 'TRANSFER_SYS',
      target: 'contentScript',
      fromActiveAccountId: sender,
      toAddress: receiver,
      amount,
      fee
    });
  }

  const handleSendNFT = async () => {
    return await sendMessage({
      type: 'SEND_NFT',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'responseSendNFT'
    }, {
      type: 'SEND_NFT',
      target: 'contentScript',
    });
  }

  const handleSendSPT = async () => {
    return await sendMessage({
      type: 'SEND_SPT',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'responseSendSPT'
    }, {
      type: 'SEND_SPT',
      target: 'contentScript',
    });
  }

  return {
    connectWallet,
    onWalletUpdate,
    getWalletState,
    getConnectedAccount,
    transferSYS,
    handleSendNFT,
    handleSendSPT
  }
};

export default ConnectionsController;