import { useController } from 'hooks/useController';

export const wallet = [
  {
    description: 'controller.wallet.setWalletPassword()',
    params: ['pwd: string'],
    returns: 'void',
    stateBefore: {},
    test: {
      params: {
        pwd: 'paliwallet123',
      },
      expected: {
        returns: 'void',
        state: {}
      }
    }
  },
  {
    description: 'controller.wallet.generatePhrase()',
    params: [],
    returns: 'potato lecture version social short monitor sick traffic furnace sure gun negative || null',
    stateBefore: {},
    test: {
      params: {},
      expected: {
        returns: 'potato lecture version social short monitor sick traffic furnace sure gun negative',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.importPhrase()',
    params: ['phrase: string'],
    returns: 'boolean',
    stateBefore: 'check state before call',
    test: {
      params: {
        phrase: '12 words - seed phrase'
      },
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.createWallet()',
    params: ['isUpdated?: boolean'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        isUpdated: 'false or true',
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.isLocked()',
    params: [],
    returns: 'boolean',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.getNewAddress()',
    params: [],
    returns: 'Promise<boolean>',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.switchWallet()',
    params: ['id: number'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        id: 0, // can be any number to test
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.createHardwareWallet()',
    params: [],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.checkPassword()',
    params: ['pwd: string'],
    returns: 'boolean',
    stateBefore: 'check state before call',
    test: {
      params: {
        pwd: 'pali123'
      },
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.deleteWallet()',
    params: ['pwd: string'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        pwd: 'pali123',
      },
      expected: {
        returns: 'void',
        state: {} // state must be the initialState, all empty
      }
    }
  },
  {
    description: 'controller.wallet.logOut()',
    params: [],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.switchNetwork()',
    params: ['networkId: string'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        networkId: 'main or testnet', // just to test
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.getPhrase()',
    params: ['pwd: string'],
    returns: 'string || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        pwd: 'pali123',
      },
      expected: {
        returns: '12 words - seed phrase || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.unLock()',
    params: ['pwd: string'],
    returns: 'boolean',
    stateBefore: 'check state before call',
    test: {
      params: {
        pwd: 'pali123',
      },
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.addNewAccount()',
    params: ['label: string'],
    returns: 'Promise<string | null>',
    stateBefore: 'check state before call',
    test: {
      params: {
        label: 'Account 1',
      },
      expected: {
        returns: 'string || null',
        state: {} // check state before and after call
      }
    }
  },
]

export const account = [
  {
    description: 'controller.wallet.account.clearTransactionItem()',
    params: ['item: string'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        item: 'mintNFT' // example
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getTransactionInfoByTxId()',
    params: ['txid: string'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        txid: 'get tx id from any transaction' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getSysExplorerSearch()',
    params: [],
    returns: 'main or testnet',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'main or testnet',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getLatestUpdate()',
    params: [],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.watchMemPool()',
    params: ['currentAccount: IAccountState'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        currentAccount: 'Iaccountstate' //todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getTransactionData()',
    params: ['txid: string'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getDataAsset()',
    params: ['assetguid: string'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        assetguid: 'string' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.updateTxs()',
    params: [],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getTransactionItem()',
    params: [],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any || null', // todo
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getRecommendFee()',
    params: [],
    returns: 'number',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'number',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.confirmTempTx()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.updateTempTx()',
    params: ['tx: ITransactionInfo'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.isValidSYSAddress()',
    params: ['address: string, network: string'],
    returns: 'boolean || undefined',
    stateBefore: 'check state before call',
    test: {
      params: {
        address: 'string',
        network: 'main or testnet' // todo
      },
      expected: {
        returns: 'true or false || undefined',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.isNFT()',
    params: ['assetguid: number'],
    returns: 'boolean',
    stateBefore: 'check state before call',
    test: {
      params: {
        assetguid: 'number' // todo
      },
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setAutolockTimer()',
    params: ['minutes: number'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        minutes: 123, // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setNewXpub()',
    params: ['id: number, xpub: string, xprv: string, key: string'],
    returns: 'boolean',
    stateBefore: 'check state before call',
    test: {
      params: {
        id: 0,
        xpub: 'string',
        xprv: 'string',
        key: 'string', // todo
      },
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.updateTokensState()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.decryptAES()',
    params: ['encryptedString: any, key: string'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        encryptedString: 'any',
        key: 'string', // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.confirmNewSPT()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromWalletToCreateSPT()',
    params: ['data: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.confirmIssueSPT()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromWalletToMintSPT()',
    params: ['data: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.confirmIssueNFT()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromWalletToMintNFT()',
    params: ['data: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.confirmIssueNFTTx()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromWalletToIssueNFT()',
    params: ['data: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.importPsbt()',
    params: ['psbt: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        psbt: 'any in psbt format' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getPrimaryAccount()',
    params: ['pwd: string, sjs: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        pwd: 'pali123',
        sjs: {}, // todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.confirmTransferOwnership()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.confirmUpdateAssetTransaction()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getConnectedAccount()',
    params: [],
    returns: 'IAccountState',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'IAccountState',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.confirmSignature()',
    params: ['sendPSBT: boolean'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        sendPSBT: 'true or false' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setHDSigner()',
    params: ['accountId: number'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        accountId: 0, // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getConnectedAccountXpub()',
    params: [],
    returns: 'string || null',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'string || null', // todo
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getChangeAddress()',
    params: [],
    returns: 'string',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'change address', // todo
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.isValidSYSAddress()',
    params: [],
    returns: '',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getHoldingsData()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.createSPT()',
    params: ['spt: ISPTInfo'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        spt: 'isptinfo' // todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getDataFromPageToInitTransaction()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getUserMintedTokens()',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setCurrentPSBT()',
    params: ['psbt: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        psbt: 'psbt object' //todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setCurrentPsbtToSign()',
    params: ['psbtToSign: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        psbtToSign: 'psbt object', // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.updateTempTx()',
    params: [],
    returns: '',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromPageToCreateNewSPT()',
    params: ['data: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromPageToMintSPT()',
    params: ['data: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromPageToUpdateAsset()',
    params: ['data: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromPageToTransferOwnership()',
    params: ['data: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromPageToIssueNFT()',
    params: ['data: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromPageToMintNFT()',
    params: ['data: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.updateAccountLabel()',
    params: ['id: number, label: string'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        id: 0,
        label: 'Account 2' // todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromWalletToTransferOwnership()',
    params: ['data: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.subscribeAccount()',
    params: ['encriptedPassword: any, isHardwareWallet: boolean, sjs?: any, label?: string, walletCreation?: boolean'],
    returns: 'string || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        encriptedPassword: 'string',
        isHardwareWallet: false,
        sjs: {},
        label: 'account label',
        walletCreation: false, // todo
      },
      expected: {
        returns: 'string || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setNewAddress()',
    params: ['address: string'],
    returns: 'boolean',
    stateBefore: 'check state before call',
    test: {
      params: {
        address: 'string' // todo
      },
      expected: {
        returns: 'true or false',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setNewOwnership()',
    params: ['data: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setNewIssueNFT()',
    params: ['data: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setDataFromWalletToUpdateAsset()',
    params: ['data: any'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        data: 'any' // todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.setUpdateAsset()',
    params: ['asset: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        asset: 'any' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.issueNFT()',
    params: ['nft: INFTIssue'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        nft: 'INFTIssue' // todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.issueSPT()',
    params: ['spt: ISPTIssue'],
    returns: 'void',
    stateBefore: 'check state before call',
    test: {
      params: {
        spt: 'ISPTIssue' // todo
      },
      expected: {
        returns: 'void',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'controller.wallet.account.getRawTransaction()',
    params: ['txid: string'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        txid: 'string' // todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
]

export const connection = [
  {
    description: 'connectWallet',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any', // todo
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'getChangeAddress',
    params: [],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'getConnectedAccount',
    params: [],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'getConnectedAccountXpub',
    params: [],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'getDataAsset',
    params: ['assetGuid: number'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        assetGuid: '3242341' //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'getHoldingsData',
    params: [],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'getUserMintedTokens',
    params: [],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'getWalletState',
    params: [],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'handleCreateNFT',
    params: ['items: CreateAndIssueNFTItems'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        items: 'CreateAndIssueNFTItems' //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'handleCreateToken',
    params: ['items: CreateTokenItems'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        items: 'CreateTokenItems' //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'handleIssueNFT',
    params: ['amount: number, assetGuid: string'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        amount: 1,
        assetGuid: 93483249 //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'handleIssueSPT',
    params: ['items: IssueTokenItems'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        items: 'IssueTokenItems' //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'handleSendToken',
    params: ['items: SendTokenItems'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        items: 'SendTokenItems' //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'handleTransferOwnership',
    params: ['items: TransferOwnershipItems'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        items: 'TransferOwnershipItems' //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'handleUpdateAsset',
    params: ['items: UpdateAssetItems'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        items: 'UpdateAssetItems' //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'isLocked',
    params: [],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {},
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'isNFT',
    params: ['guid: number'],
    returns: 'boolean || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        guid: 1232134134 //todo
      },
      expected: {
        returns: 'boolean || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'isValidSYSAddress',
    params: ['address: string'],
    returns: 'boolean || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        address: 'string' //todo
      },
      expected: {
        returns: 'boolean || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'onWalletUpdate',
    params: ['callback: any'],
    returns: 'any',
    stateBefore: 'check state before call',
    test: {
      params: {
        callback: 'any' //todo
      },
      expected: {
        returns: 'any',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'signAndSend',
    params: ['psbt: any'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        psbt: 'psbt object' //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
  {
    description: 'signPSBT',
    params: ['psbtToSign: any'],
    returns: 'any || null',
    stateBefore: 'check state before call',
    test: {
      params: {
        psbtToSign: 'psbtToSign object' //todo
      },
      expected: {
        returns: 'any || null',
        state: {} // check state before and after call
      }
    }
  },
];

export const controller = useController();