import { sendMessage } from 'scripts/Background/helpers';

const ConnectionsController = (): IConnectionsController => {
  const getConnectedAccountXpub = async () => {
    return sendMessage(
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
    );
  };

  const getChangeAddress = async () => {
    return sendMessage(
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
    );
  };

  const signTransaction = async (psbt: any) => {
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

      await sendMessage(
        {
          type: 'SIGN_TRANSACTION',
          target: 'connectionsController',
          freeze: true,
          eventResult: 'complete',
        },
        {
          type: 'SIGN_TRANSACTION',
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
        console.log('event on wallet updated', event.data);
        onUpdated();
      }
    });
  };

  const isNFT = (guid: number) => {
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
    return sendMessage(
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
    );
  };

  const getConnectedAccount = async () => {
    return sendMessage(
      {
        type: 'SEND_CONNECTED_ACCOUNT',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'connectedAccount',
      },
      {
        type: 'SEND_CONNECTED_ACCOUNT',
        target: 'contentScript',
      }
    );
  };

  const handleSendToken = async (items: SendTokenItems) => {
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
          capabilityflags: String(capabilityflags),
          notarydetails: notarydetails || null,
          auxfeedetails: auxfeedetails || null,
          notaryAddress: notaryAddress || null,
          payoutAddress: payoutAddress || null,
        }
      );
    });
  };

  const handleIssueSPT = async (items: IssueTokenItems) => {
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

      console.log('items create nft', items)

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

  const handleIssueNFT = async (amount: number, assetGuid: string) => {
    return sendMessage(
      {
        type: 'ISSUE_NFT',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'complete',
      },
      {
        type: 'ISSUE_NFT',
        target: 'contentScript',
        amount,
        assetGuid,
      }
    );
  };

  const getUserMintedTokens = async () => {
    return sendMessage(
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
    );
  };

  const getDataAsset = async (assetGuid: any) => {
    return sendMessage(
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
    );
  };

  const handleUpdateAsset = async (items: UpdateAssetItems) => {
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
          capabilityflags: String(capabilityflags),
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
    return sendMessage(
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
    );
  };

  const getHoldingsData = async () => {
    return sendMessage(
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
    );
  };

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
    signTransaction,
    getConnectedAccountXpub,
    getChangeAddress,
  };
};

export default ConnectionsController;
