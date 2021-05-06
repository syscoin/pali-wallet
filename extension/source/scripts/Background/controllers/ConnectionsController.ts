import { sendMessage } from 'containers/auth/helpers';

export interface IConnectionsController {
  connectWallet: () => any;
  onWalletUpdate: (callback: any) => any;
  getWalletState: () => any;
  getConnectedAccount: () => any;
  handleSendToken: (sender: string, receiver: string, amount: number, fee: number, token: any, isToken: boolean, rbf: boolean) => any;
  handleCreateToken: (precision: number, symbol: string, maxsupply: number, fee: number, description: string, receiver: string, rbf: boolean) => any;
  handleIssueAsset: (rbf: boolean, fee: number, assetGuid: string, amount: number, receiver: string) => any;
  handleIssueNFT: (rbf: boolean, fee: number, assetGuid: string, nfthash: string, receiver: string) => any;
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
      fromConnectedAccount: sender,
      toAddress: receiver,
      amount,
      fee,
      token,
      isToken,
      rbf
    });
  }

  const handleCreateToken = async (precision: number, symbol: string, maxsupply: number, fee: number, description: string, receiver: string, rbf: boolean) => {
    return await sendMessage({
      type: 'CREATE_TOKEN',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'complete'
    }, {
      type: 'CREATE_TOKEN',
      target: 'contentScript',
      precision,
      symbol,
      maxsupply,
      fee,
      description,
      receiver,
      rbf
    });
  }
  const handleIssueAsset = async (rbf: boolean, fee: number, assetGuid: string, amount: number, receiver: string) => {
    return await sendMessage({
      type: 'ISSUE_TOKEN',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'complete'
    }, {
      type: 'ISSUE_TOKEN',
      target: 'contentScript',
      assetGuid,
      amount,
      receiver,
      fee,
      rbf
    });
  }

  const handleIssueNFT = async (rbf: boolean, fee: number, assetGuid: string, nfthash: string, receiver: string) => {
    return await sendMessage({
      type: 'ISSUE_NFT',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'complete'
    }, {
      type: 'ISSUE_NFT',
      target: 'contentScript',
      assetGuid,
      nfthash,
      receiver,
      fee,
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
    handleCreateToken,
    handleIssueAsset,
    handleIssueNFT
  }
};

export default ConnectionsController;