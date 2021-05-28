import { sendMessage } from 'containers/auth/helpers';

export interface IConnectionsController {
  connectWallet: () => any;
  onWalletUpdate: (callback: any) => any;
  getWalletState: () => any;
  getConnectedAccount: () => any;
  handleSendToken: (sender: string, receiver: string, amount: number, fee: number, token: any, isToken: boolean, rbf: boolean) => any;
  handleCreateToken: (precision: number, symbol: string, maxsupply: number,description: string, receiver: string) => any;
  handleIssueSPT: (amount: number, receiver: string, assetGuid: string) => any;
  handleIssueNFT: (assetGuid: string, nfthash: string, receiver: string) => any;
  isNFT: (guid: number) => boolean;
  getUserMintedTokens: () => any;
  handleCreateCollection: (state: any) => void;
}

const isNFT = (guid: number) => {
  let assetGuid = BigInt.asUintN(64, BigInt(guid));

  return (assetGuid >> BigInt(32)) > 0
}

const ConnectionsController = (): IConnectionsController => {
  const onWalletUpdate = (onUpdated: any) => {
    window.addEventListener('message', (event) => {
      if (event.data.type === 'WALLET_UPDATED' && event.data.target === 'connectionsController') {
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

  const handleCreateToken = async (precision: number, symbol: string, maxsupply: number, description: string, receiver: string) => {
    return await sendMessage({
      type: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'complete'
    }, {
      type: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
      target: 'contentScript',
      precision,
      symbol,
      maxsupply,
      description,
      receiver
    });
  }

  const handleIssueSPT = async (amount: number, receiver: string, assetGuid: string) => {
    console.log('handleissuespt', amount, receiver, assetGuid)
    return await sendMessage({
      type: 'ISSUE_SPT',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'complete'
    }, {
      type: 'ISSUE_SPT',
      target: 'contentScript',
      amount,
      receiver,
      assetGuid
    });
  }

  const handleIssueNFT = async (assetGuid: string, nfthash: string, receiver: string) => {
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
    });
  }

  const getUserMintedTokens = async () => {
    return await sendMessage({
      type: 'GET_USERMINTEDTOKENS',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'userTokens'
    }, {
      type: 'GET_USERMINTEDTOKENS',
      target: 'contentScript',
    });
  }

  const handleCreateCollection = async (state: { collectionName: string, description: string, sysAddress: string, symbol: any, property1?: string, property2?: string, property3?: string, attribute1?: string, attribute2?: string, attribute3?: string }) => {
    const {
      collectionName,
      description,
      sysAddress,
      symbol,
      property1,
      property2,
      property3,
      attribute1,
      attribute2,
      attribute3
    } = state;

    console.log('[connectionsController]: state', state)

    return await sendMessage({
      // check if the message received (from contentScript after contentScript receives the message from background (where it all starts)) has this type and target and set the eventResult
      type: 'CREATE_COLLECTION',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'createCollection'
    }, {
      // send the data to contentScript through this message
      type: 'CREATE_COLLECTION',
      target: 'contentScript',
      collectionName,
      description,
      sysAddress,
      symbol,
      property1,
      property2,
      property3,
      attribute1,
      attribute2,
      attribute3
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
    handleIssueSPT,
    handleIssueNFT,
    getUserMintedTokens,
    handleCreateCollection
  }
};

export default ConnectionsController;