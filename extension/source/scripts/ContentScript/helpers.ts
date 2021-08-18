export const getMessagesToListenTo = (request: any) => {
  const {
    complete,
    connected,
    state,
    connectedAccount,
    userTokens,
    connectionConfirmed,
    isValidSYSAddress,
    holdingsData,
    assetData,
    message,
    response,
    isLocked,
    signedTransaction,
    connectedAccountXpub,
    connectedAccountChangeAddress,
    signedPSBT
  } = request;

  const postMessagesArray = [
    {
      messageType: 'SEND_STATE_TO_PAGE',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'state',
      messageResponse: state,
    },
    {
      messageType: 'CHECK_IS_LOCKED',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'isLocked',
      messageResponse: isLocked,
    },
    {
      messageType: 'SEND_CONNECTED_ACCOUNT',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'connectedAccount',
      messageResponse: connectedAccount,
    },
    {
      messageType: 'CONNECTED_ACCOUNT_XPUB',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'connectedAccountXpub',
      messageResponse: connectedAccountXpub,
    },
    {
      messageType: 'CONNECTED_ACCOUNT_CHANGE_ADDRESS',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'connectedAccountChangeAddress',
      messageResponse: connectedAccountChangeAddress,
    },
    {
      messageType: 'CONNECT_WALLET',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'complete',
      messageResponse: complete,
    },
    {
      messageType: 'WALLET_UPDATED',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'connected',
      messageResponse: connected,
    },
    {
      messageType: 'WALLET_CONNECTION_CONFIRMED',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'connectionConfirmed',
      messageResponse: connectionConfirmed,
    },
    {
      messageType: 'CHECK_ADDRESS',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'isValidSYSAddress',
      messageResponse: isValidSYSAddress,
    },
    {
      messageType: 'SIGN_TRANSACTION',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'signedTransaction',
      messageResponse: signedTransaction,
    },
    {
      messageType: 'SIGN_PSBT',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'signedPSBT',
      messageResponse: signedPSBT,
    },
    {
      messageType: 'GET_HOLDINGS_DATA',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'holdingsData',
      messageResponse: holdingsData,
    },
    {
      messageType: 'GET_USER_MINTED_TOKENS',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'userTokens',
      messageResponse: userTokens,
    },
    {
      messageType: 'WALLET_ERROR',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'error',
      messageResponse: message,
    },
    {
      messageType: 'TRANSACTION_RESPONSE',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'response',
      messageResponse: response,
    },
    {
      messageType: 'SEND_TOKEN',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'complete',
      messageResponse: complete,
    },
    {
      messageType: 'GET_ASSET_DATA',
      messageTarget: 'contentScript',
      messageNewTarget: 'connectionsController',
      responseItem: 'assetData',
      messageResponse: assetData,
    },
  ];

  return postMessagesArray;
};

export const listenAndSendMessageFromPageToBackground = (event: any) => {
  const {
    fromConnectedAccount,
    toAddress,
    amount,
    fee,
    token,
    isToken,
    rbf,
    precision,
    maxsupply,
    receiver,
    initialSupply,
    symbol,
    issuer,
    contract,
    capabilityflags,
    description,
    notarydetails,
    auxfeedetails,
    notaryAddress,
    payoutAddress,
    assetGuid,
    address,
    newOwner,
    psbt,
    psbtToSign
  } = event.data;

  const sendToken = {
    fromConnectedAccount,
    toAddress,
    amount,
    fee,
    token,
    isToken,
    rbf,
  };

  const dataFromPageToCreateToken = {
    precision,
    symbol,
    maxsupply,
    description,
    receiver,
    initialSupply,
    capabilityflags,
    notarydetails,
    auxfeedetails,
    notaryAddress,
    payoutAddress,
  };

  const dataFromPageToIssueToken = {
    amount,
    assetGuid,
  };

  const dataFromPageToCreateAndIssueNFT = {
    symbol,
    issuer,
    precision,
    description,
    notarydetails,
    auxfeedetails,
    notaryAddress,
    payoutAddress,
  };

  const dataFromPageToUpdateAsset = {
    assetGuid,
    contract,
    capabilityflags,
    description,
    notarydetails,
    auxfeedetails,
    notaryAddress,
    payoutAddress,
  };

  const dataFromPageToTransferOwnership = {
    assetGuid,
    newOwner,
  };

  const browserMessagesArray = [
    {
      messageType: 'SEND_TOKEN',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: sendToken,
    },
    {
      messageType: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: dataFromPageToCreateToken,
    },
    {
      messageType: 'ISSUE_SPT',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: dataFromPageToIssueToken,
    },
    {
      messageType: 'CREATE_AND_ISSUE_NFT',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: dataFromPageToCreateAndIssueNFT,
    },
    {
      messageType: 'UPDATE_ASSET',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: dataFromPageToUpdateAsset,
    },
    {
      messageType: 'TRANSFER_OWNERSHIP',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: dataFromPageToTransferOwnership,
    },
    {
      messageType: 'GET_ASSET_DATA',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: assetGuid,
    },
    {
      messageType: 'GET_USER_MINTED_TOKENS',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: null,
    },
    {
      messageType: 'GET_HOLDINGS_DATA',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: null,
    },
    {
      messageType: 'CHECK_ADDRESS',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: address,
    },
    {
      messageType: 'SIGN_TRANSACTION',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: psbt,
    },
    {
      messageType: 'SIGN_PSBT',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: psbtToSign,
    },
    {
      messageType: 'SEND_CONNECTED_ACCOUNT',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: null,
    },
    {
      messageType: 'CONNECTED_ACCOUNT_XPUB',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: null,
    },
    {
      messageType: 'CONNECTED_ACCOUNT_CHANGE_ADDRESS',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: null,
    },
    {
      messageType: 'SEND_STATE_TO_PAGE',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: null,
    },
    {
      messageType: 'CHECK_IS_LOCKED',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: null,
    },
    {
      messageType: 'CONNECT_WALLET',
      messageTarget: 'contentScript',
      messageNewTarget: 'background',
      messageData: null,
    },
  ];

  return browserMessagesArray;
};
