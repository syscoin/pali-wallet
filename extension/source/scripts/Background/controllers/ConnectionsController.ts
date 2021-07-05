import { sendMessage } from 'containers/auth/helpers';

export interface IConnectionsController {
  connectWallet: () => any;
  onWalletUpdate: (callback: any) => any;
  getWalletState: () => any;
  getConnectedAccount: () => any;
  handleSendToken: (sender: string, receiver: string, amount: number, fee: number, token: any, isToken: boolean, rbf: boolean) => any;
  handleCreateToken: (
    precision: number,
    symbol: string,
    maxsupply: number,
    description: string,
    receiver: string,
    capabilityflags?: number,
    notarydetails?: {
      endpoint?: string,
      instanttransfers?: boolean,
      hdrequired?: boolean
    },
    auxfeedetails?: {
      auxfeekeyid: string,
      auxfees: [{
        bound: any | 0,
        percent: any | 0
      }]
    },
    notaryAddress?: string,
    payoutAddress?: string
  ) => any;
  handleIssueSPT: (amount: number, assetGuid: string) => any;
  handleCreateNFT: (
    symbol: string,
    issuer: string,
    totalShares: number,
    description: string,
    notary?: boolean,
    notarydetails?: {
      endpoint?: string | null,
      instanttransfers?: boolean,
      hdrequired?: boolean
    },
    auxfee?: boolean,
    auxfeedetails?: {
      auxfeekeyid: string,
      auxfees: [{
        bound: any | 0,
        percent: any | 0
      }]
    },
    notaryAddress?: string,
    payoutAddress?: string
  ) => any;
  handleIssueNFT: (amount: number, assetGuid: string) => any;
  isNFT: (guid: number) => boolean;
  getUserMintedTokens: () => Promise<any>;
  handleUpdateAsset: (
    assetGuid: string,
    contract?: string,
    capabilityflags?: string | '127',
    description?: string,
    notarydetails?: {
      endpoint?: string | null,
      instanttransfers?: boolean,
      hdrequired?: boolean
    },
    auxfeedetails?: {
      auxfeekeyid: string,
      auxfees: [{
        bound: any | 0,
        percent: any | 0
      }]
    },
    notaryAddress?: string
  ) => any;
  handleTransferOwnership: (assetGuid: string, newOwner: string) => any;
  isValidSYSAddress: (address: string) => any;
  getHoldingsData: () => any;
  getDataAsset: (assetGuid: any) => any;
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
    sendMessage({
      type: 'CONNECT_WALLET',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'connected'
    }, {
      type: 'CONNECT_WALLET',
      target: 'contentScript'
    })

    return await sendMessage({
      type: 'WALLET_CONNECTION_CONFIRMED',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'connectionConfirmed'
    }, {
      type: 'WALLET_CONNECTION_CONFIRMED',
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

  const handleCreateToken = async (precision: number, symbol: string, maxsupply: number, description: string, receiver: string, capabilityflags?: number, notarydetails?: { endpoint?: string | null, instanttransfers?: boolean, hdrequired?: boolean }, auxfeedetails?: { auxfeekeyid: string, auxfees: [{ bound: any | 0, percent: any | 0 }] }, notaryAddress?: string, payoutAddress?: string) => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (event.data.type === 'TRANSACTION_ERROR' && event.data.target === 'connectionsController') {
          console.log('event data', event.data, event.data.error)
          reject(event.data.error);
        }
  
        return null;
      }
      
      window.addEventListener('message', callback);
      
      await sendMessage({
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
        description: description || null,
        receiver,
        capabilityflags: capabilityflags || '0',
        notarydetails: notarydetails || null,
        auxfeedetails: auxfeedetails || null,
        notaryAddress: notaryAddress || null,
        payoutAddress: payoutAddress || null
      });
      
      resolve('ok connections update')
  
      window.removeEventListener('message', callback);
    });
  }

  const handleIssueSPT = async (amount: number, assetGuid: string) => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (event.data.type === 'TRANSACTION_ERROR' && event.data.target === 'connectionsController') {
          console.log('event data', event.data, event.data.error)
          reject(event.data.error);
        }
  
        return null;
      }
      
      window.addEventListener('message', callback);
      
      await sendMessage({
        type: 'ISSUE_SPT',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'complete'
      }, {
        type: 'ISSUE_SPT',
        target: 'contentScript',
        amount,
        assetGuid
      });
      
      resolve('ok connections update')
  
      window.removeEventListener('message', callback);
    });
  }

  const handleCreateNFT = async (symbol: string, issuer: string, totalShares: number, description: string, notary?: boolean, notarydetails?: { endpoint?: string | null, instanttransfers?: boolean, hdrequired?: boolean }, auxfee?: boolean, auxfeedetails?: { auxfeekeyid: string, auxfees: [{ bound: any | 0, percent: any | 0 }] }, notaryAddress?: string, payoutAddress?: string) => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (event.data.type === 'TRANSACTION_ERROR' && event.data.target === 'connectionsController') {
          console.log('event data', event.data, event.data.error)
          reject(event.data.error);
        }
  
        return null;
      }
      
      window.addEventListener('message', callback);
      
      await sendMessage({
        type: 'CREATE_AND_ISSUE_NFT',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'complete'
      }, {
        type: 'CREATE_AND_ISSUE_NFT',
        target: 'contentScript',
        symbol,
        issuer,
        totalShares: totalShares || 0,
        description: description || null,
        notary: notary || false,
        notarydetails: notarydetails || null,
        auxfee: auxfee || false,
        auxfeedetails: auxfeedetails || null,
        notaryAddress: notaryAddress || null,
        payoutAddress: payoutAddress || null
      });
      
      resolve('ok connections update')
  
      window.removeEventListener('message', callback);
    });
  }

  const handleIssueNFT = async (amount: number, assetGuid: string) => {
    return await sendMessage({
      type: 'ISSUE_NFT',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'complete'
    }, {
      type: 'ISSUE_NFT',
      target: 'contentScript',
      amount,
      assetGuid
    });
  }

  const getUserMintedTokens = async () => {
    return await sendMessage({
      type: 'GET_USER_MINTED_TOKENS',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'userTokens'
    }, {
      type: 'GET_USER_MINTED_TOKENS',
      target: 'contentScript',
    });
  }

  const getDataAsset = async (assetGuid: any) => {
    return await sendMessage({
      type: 'GET_ASSET_DATA',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'assetData'
    }, {
      type: 'GET_ASSET_DATA',
      target: 'contentScript',
      assetGuid,
    });
  }

  const handleUpdateAsset = async (assetGuid: string, contract?: string | null, capabilityflags?: string | '0', description?: string | null, notarydetails?: { endpoint?: string | null, instanttransfers?: boolean, hdrequired?: boolean } | null, auxfeedetails?: { auxfeekeyid?: any, auxfees?: [{ bound?: any | 0, percent?: any | 0 }] } | null, notaryAddress?: string | null, payoutAddress?: string | null) => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (event.data.type === 'TRANSACTION_ERROR' && event.data.target === 'connectionsController') {
          console.log('event data', event.data, event.data.error)
          reject(event.data.error);
        }
  
        return null;
      }
      
      window.addEventListener('message', callback);
      
      await sendMessage({
        type: 'UPDATE_ASSET',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'complete'
      }, {
        type: 'UPDATE_ASSET',
        target: 'contentScript',
        assetGuid,
        contract: contract || null,
        capabilityflags: capabilityflags || '0',
        description: description || null,
        notarydetails: notarydetails || null,
        auxfeedetails: auxfeedetails || null,
        notaryAddress: notaryAddress || null,
        payoutAddress: payoutAddress || null
      });
      
      resolve('ok connections update')
  
      window.removeEventListener('message', callback);
    });
  }


  const handleTransferOwnership = async (assetGuid: string, newOwner: string) => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (event.data.type === 'TRANSACTION_ERROR' && event.data.target === 'connectionsController') {
          console.log('event data', event.data, event.data.error)
          reject(event.data.error);
        }
  
        return null;
      }
      
      window.addEventListener('message', callback);
      
      await sendMessage({
        type: 'TRANSFER_OWNERSHIP',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'complete'
      }, {
        type: 'TRANSFER_OWNERSHIP',
        target: 'contentScript',
        assetGuid,
        newOwner
      });
      
      resolve('ok connections update')
  
      window.removeEventListener('message', callback);
    });
    // return await sendMessage({
    //   type: 'TRANSFER_OWNERSHIP',
    //   target: 'connectionsController',
    //   freeze: true,
    //   eventResult: 'complete'
    // }, {
    //   type: 'TRANSFER_OWNERSHIP',
    //   target: 'contentScript',
    //   assetGuid,
    //   newOwner
    // });
  }

  const isValidSYSAddress = async (address: string) => {
    return await sendMessage({
      type: 'CHECK_ADDRESS',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'isValidSYSAddress'
    }, {
      type: 'CHECK_ADDRESS',
      target: 'contentScript',
      address,
    });
  }

  const getHoldingsData = async () => {
    return await sendMessage({
      type: 'GET_HOLDINGS_DATA',
      target: 'connectionsController',
      freeze: true,
      eventResult: 'holdingsData'
    }, {
      type: 'GET_HOLDINGS_DATA',
      target: 'contentScript',
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
    handleCreateNFT,
    getUserMintedTokens,
    handleUpdateAsset,
    handleTransferOwnership,
    isValidSYSAddress,
    getHoldingsData,
    getDataAsset,
    handleIssueNFT
  }
};

export default ConnectionsController;