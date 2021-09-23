import { sendMessage } from 'scripts/Background/helpers';

const ConnectionsController = () => {
  const checkParams = ({ data, throwError, message }: any) => {
    if (!data) {
      if (throwError) {
        throw new Error(message);
      }

      console.log(message);

      return;
    }
  }

  const getConnectedAccountXpub = async () => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      resolve(await sendMessage(
        {
          type: 'CONNECTED_ACCOUNT_XPUB',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'connectedAccountXpub',
        },
        {
          type: 'CONNECTED_ACCOUNT_XPUB',
          target: 'contentScript',
        }
      ));
    });
  };

  const getChangeAddress = async () => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      resolve(await sendMessage(
        {
          type: 'CONNECTED_ACCOUNT_CHANGE_ADDRESS',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'connectedAccountChangeAddress',
        },
        {
          type: 'CONNECTED_ACCOUNT_CHANGE_ADDRESS',
          target: 'contentScript',
        }
      ));
    });
  };

  const signAndSend = async (psbt: any) => {
    checkParams({ data: psbt, throwError: true, message: 'PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.' });

    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        if (
          event.data.type === 'TRANSACTION_RESPONSE' &&
          event.data.target === 'connectionsController'
        ) {
          resolve(event.data.response);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      await sendMessage(
        {
          type: 'SIGN_AND_SEND',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'SIGN_AND_SEND',
          target: 'contentScript',
          psbt,
        }
      );
    });
  };

  const isLocked = async () => {
    return sendMessage(
      {
        type: 'CHECK_IS_LOCKED',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'isLocked',
      },
      {
        type: 'CHECK_IS_LOCKED',
        target: 'contentScript',
      }
    );
  };

  const onWalletUpdate = (onUpdated: any) => {
    window.addEventListener('message', (event) => {
      if (
        event.data.type === 'WALLET_UPDATED' &&
        event.data.target === 'connectionsController'
      ) {
        onUpdated();
      }
    });
  };

  const isNFT = (guid: number) => {
    checkParams({ data: guid, throwError: false, message: 'Invalid asset guid.' });

    const assetGuid = BigInt.asUintN(64, BigInt(guid));

    return assetGuid >> BigInt(32) > 0;
  };

  const connectWallet = async () => {
    sendMessage(
      {
        type: 'CONNECT_WALLET',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'connected',
      },
      {
        type: 'CONNECT_WALLET',
        target: 'contentScript',
      }
    );

    return sendMessage(
      {
        type: 'WALLET_CONNECTION_CONFIRMED',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'connectionConfirmed',
      },
      {
        type: 'WALLET_CONNECTION_CONFIRMED',
        target: 'contentScript',
      }
    );
  };

  const getWalletState = async () => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      resolve(await sendMessage(
        {
          type: 'SEND_STATE_TO_PAGE',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'state',
        },
        {
          type: 'SEND_STATE_TO_PAGE',
          target: 'contentScript',
        }
      ));
    });
  };

  const getConnectedAccount = async () => {
    return sendMessage(
      {
        type: 'SEND_CONNECTED_ACCOUNT',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'copyConnectedAccount',
      },
      {
        type: 'SEND_CONNECTED_ACCOUNT',
        target: 'contentScript',
      }
    );
  };

  const handleSendToken = async (items: SendTokenItems) => {
    checkParams({ data: items, throwError: false, message: 'Invalid token data.' });

    if (items.isToken && typeof items.token !== 'string') {
      throw new Error('Invalid token data.');
    }

    return new Promise(async (_, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      const { sender, receiver, amount, fee, token, isToken, rbf } = items;

      await sendMessage(
        {
          type: 'SEND_TOKEN',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'SEND_TOKEN',
          target: 'contentScript',
          fromConnectedAccount: sender,
          toAddress: receiver,
          amount,
          fee,
          token,
          isToken,
          rbf,
        }
      );
    });
  };

  const handleCreateToken = async (items: CreateTokenItems) => {
    const connectedAccount: any = await getConnectedAccount();

    if (connectedAccount && connectedAccount.isTrezorWallet) {
      console.log('Trezor don\'t support burning of coins.');

      throw new Error('Trezor don\'t support burning of coins.');
    }

    checkParams({ data: items, throwError: false, message: 'Invalid token data.' });

    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        if (
          event.data.type === 'TRANSACTION_RESPONSE' &&
          event.data.target === 'connectionsController'
        ) {
          resolve(event.data.response);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      const {
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
      } = items;

      await sendMessage(
        {
          type: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
          target: 'contentScript',
          precision: precision >= 0 ? precision : 8,
          symbol,
          maxsupply,
          description: description || null,
          receiver,
          initialSupply: initialSupply || 0,
          capabilityflags: capabilityflags ? String(capabilityflags) : '127',
          notarydetails: notarydetails || null,
          auxfeedetails: auxfeedetails || null,
          notaryAddress: notaryAddress || null,
          payoutAddress: payoutAddress || null,
        }
      );
    });
  };

  const handleIssueSPT = async (items: IssueTokenItems) => {
    checkParams({ data: items, throwError: false, message: 'Invalid token data.' });

    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        if (
          event.data.type === 'TRANSACTION_RESPONSE' &&
          event.data.target === 'connectionsController'
        ) {
          resolve(event.data.response);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      const { amount, assetGuid } = items;

      await sendMessage(
        {
          type: 'ISSUE_SPT',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'ISSUE_SPT',
          target: 'contentScript',
          amount,
          assetGuid,
        }
      );
    });
  };

  const handleCreateNFT = async (items: CreateAndIssueNFTItems) => {
    checkParams({ data: items, throwError: false, message: 'Invalid token data.' });

    return new Promise(async (_, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      const {
        symbol,
        issuer,
        precision,
        description,
        notarydetails,
        auxfeedetails,
        notaryAddress,
        payoutAddress,
      } = items;

      await sendMessage(
        {
          type: 'CREATE_AND_ISSUE_NFT',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'CREATE_AND_ISSUE_NFT',
          target: 'contentScript',
          symbol,
          issuer,
          precision: precision || 0,
          description: description || null,
          notarydetails: notarydetails || null,
          auxfeedetails: auxfeedetails || null,
          notaryAddress: notaryAddress || null,
          payoutAddress: payoutAddress || null,
        }
      );
    });
  };

  const handleIssueNFT = async (items: any) => {
    checkParams({ data: items, throwError: false, message: 'Invalid token data.' });

    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        if (
          event.data.type === 'TRANSACTION_RESPONSE' &&
          event.data.target === 'connectionsController'
        ) {
          resolve(event.data.response);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      const { assetGuid, amount } = items;

      await sendMessage(
        {
          type: 'ISSUE_NFT',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'ISSUE_NFT',
          target: 'contentScript',
          assetGuid,
          amount
        }
      );
    });
  };

  const getUserMintedTokens = async () => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      resolve(await sendMessage(
        {
          type: 'GET_USER_MINTED_TOKENS',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'userTokens',
        },
        {
          type: 'GET_USER_MINTED_TOKENS',
          target: 'contentScript',
        }
      ));
    });
  };

  const getDataAsset = async (assetGuid: any) => {
    checkParams({ data: assetGuid, throwError: false, message: 'Invalid token data.' });

    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      resolve(await sendMessage(
        {
          type: 'GET_ASSET_DATA',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'assetData',
        },
        {
          type: 'GET_ASSET_DATA',
          target: 'contentScript',
          assetGuid,
        }
      ));
    });
  };

  const handleUpdateAsset = async (items: UpdateAssetItems) => {
    checkParams({ data: items, throwError: false, message: 'Invalid token data.' });

    return new Promise(async (_, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      const {
        assetGuid,
        contract,
        capabilityflags,
        description,
        notarydetails,
        auxfeedetails,
        notaryAddress,
        payoutAddress,
      } = items;

      await sendMessage(
        {
          type: 'UPDATE_ASSET',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'UPDATE_ASSET',
          target: 'contentScript',
          assetGuid,
          contract: contract || null,
          capabilityflags: capabilityflags ? String(capabilityflags) : '127',
          description: description || null,
          notarydetails: notarydetails || null,
          auxfeedetails: auxfeedetails || null,
          notaryAddress: notaryAddress || null,
          payoutAddress: payoutAddress || null,
        }
      );
    });
  };

  const handleTransferOwnership = async (items: TransferOwnershipItems) => {
    checkParams({ data: items, throwError: false, message: 'Invalid token data.' });

    return new Promise(async (_, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      const { assetGuid, newOwner } = items;

      await sendMessage(
        {
          type: 'TRANSFER_OWNERSHIP',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'TRANSFER_OWNERSHIP',
          target: 'contentScript',
          assetGuid,
          newOwner,
        }
      );
    });
  };

  const isValidSYSAddress = async (address: string) => {
    checkParams({ data: address, throwError: true, message: 'Invalid address.' });

    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      resolve(await sendMessage(
        {
          type: 'CHECK_ADDRESS',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'isValidSYSAddress',
        },
        {
          type: 'CHECK_ADDRESS',
          target: 'contentScript',
          address,
        }
      ));
    });
  };

  const getHoldingsData = async () => {
    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      resolve(await sendMessage(
        {
          type: 'GET_HOLDINGS_DATA',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'holdingsData',
        },
        {
          type: 'GET_HOLDINGS_DATA',
          target: 'contentScript',
        }
      ));
    });
  };

  const signPSBT = (psbtToSign: any) => {
    checkParams({ data: psbtToSign, throwError: true, message: 'PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.' });

    return new Promise(async (resolve, reject) => {
      const callback = (event: any) => {
        if (
          event.data.type === 'WALLET_ERROR' &&
          event.data.target === 'connectionsController'
        ) {
          reject(event.data.error);

          window.removeEventListener('message', callback);
        }

        if (
          event.data.type === 'TRANSACTION_RESPONSE' &&
          event.data.target === 'connectionsController'
        ) {
          resolve(event.data.response);

          window.removeEventListener('message', callback);
        }

        return null;
      };

      window.addEventListener('message', callback);

      await sendMessage(
        {
          type: 'SIGN_PSBT',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'SIGN_PSBT',
          target: 'contentScript',
          psbtToSign,
        }
      );
    });
  }

  return {
    isLocked,
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
    handleIssueNFT,
    signAndSend,
    getConnectedAccountXpub,
    getChangeAddress,
    signPSBT
  };
};

const connectionsController = ConnectionsController();
export default Object.freeze(connectionsController);
