// TODO: syscoin web3 packages

// import store from 'state/store';
import { IETHPendingTx } from 'types/transactions';
// import IVaultState from 'state/vault/types';

import { XChainEthClient } from './helpers/xChainEth';

export interface IEthTransactionController {
  addPendingTx: (tx: IETHPendingTx) => boolean;
  getFullTxs: () => any[];
  startMonitor: () => void;
}

interface IPendingData {
  [txHash: string]: IETHPendingTx;
}

type ITransactionListeners = {
  [txHash: string]: {
    onConfirmed: () => void;
  };
};

const TX_STORE = 'ETH_PENDING';

const EthTransactionController = (): IEthTransactionController => {
  // add using syscoin web3 packages
  const ethClient: XChainEthClient = new XChainEthClient({
    network: 'mainnet',
    privateKey: process.env.TEST_PRIVATE_KEY,
    etherscanApiKey: process.env.ETHERSCAN_API_KEY,
    infuraCreds: { projectId: process.env.INFURA_CREDENTIAL || '' },
  });

  const transactionListeners: ITransactionListeners = {};

  const getPendingData = () => {
    const state = localStorage.getItem(TX_STORE) || '{}';
    const pendingData = JSON.parse(state);

    return pendingData as IPendingData;
  };

  // const setNetwork = (value: 'mainnet' | 'testnet') => {
  //   ethClient = new XChainEthClient({
  //     network: value,
  //     privateKey: process.env.TEST_PRIVATE_KEY,
  //     etherscanApiKey: process.env.ETHERSCAN_API_KEY,
  //     infuraCreds: { projectId: process.env.INFURA_CREDENTIAL || '' },
  //   });
  // };

  const removePendingTxHash = (txHash: string) => {
    const pendingData = getPendingData();

    if (pendingData[txHash]) {
      delete pendingData[txHash];

      localStorage.setItem(TX_STORE, JSON.stringify(pendingData));

      console.log('getting latest update', txHash);

      // window.controller.wallet.account.getLatestTxUpdate();
    }
  };

  const getFullTxs = () => {
    const pendingData = getPendingData();
    // const { networks }: IVaultState = store.getState().vault;

    // const filteredData = Object.values(pendingData).filter(
    //   (pendingTx: IETHPendingTx) =>
    //     pendingTx.network === activeNetwork.ethereum.testnet &&
    //     pendingTx.assetId === 'activeAsset.id'
    // );

    return [
      pendingData,
      // TODO: add an active asset property for web3
      // ...activeAsset.transactions,
    ];
  };

  const startMonitor = () => {
    const pendingData = getPendingData();

    Object.values(pendingData).forEach((pendingTx: IETHPendingTx) => {
      ethClient
        .waitForTransaction(
          pendingTx.txHash,
          pendingTx.network === 'mainnet' ? 1 : 3
        )
        .then(() => {
          console.log('removing pending tx');

          if (transactionListeners[pendingTx.txHash]) {
            transactionListeners[pendingTx.txHash].onConfirmed();
          }

          removePendingTxHash(pendingTx.txHash);
        });
    });
  };

  // const getTransactionHistory = async (ethAddress: string, limit: number) => {
  //   const ethTxs = await ethClient.getTransactions({
  //     address: ethAddress,
  //     limit,
  //   });

  //   return {
  //     transactions: ethTxs.txs.map((tx) => ({
  //       ...tx,
  //       timestamp: tx.date.valueOf(),
  //       balance: ethers.utils.formatEther(
  //         tx.from[0].amount.amount().toString()
  //       ),
  //     })),
  //   };
  // };

  const addPendingTx = (pendingTx: IETHPendingTx) => {
    const pendingData = getPendingData();

    if (Object.keys(pendingData).includes(pendingTx.txHash)) {
      return false;
    }
    pendingData[pendingTx.txHash] = pendingTx;
    localStorage.setItem(TX_STORE, JSON.stringify(pendingData));

    if (pendingTx.onConfirmed) {
      transactionListeners[pendingTx.txHash] = {
        onConfirmed: pendingTx.onConfirmed,
      };
    }

    startMonitor();

    return true;
  };

  // const getTokenTransactionHistory = async (
  //   ethAddress: string,
  //   asset: IAssetInfoState,
  //   limit: number
  // ) => {
  //   const transactions = await ethClient.getTransactions({
  //     address: ethAddress,
  //     limit,
  //     asset: asset.address,
  //   });

  //   return {
  //     transactions: transactions.txs.map((tx: any) => ({
  //       ...tx,
  //       timestamp: tx.date.valueOf(),
  //       balance: ethers.utils.formatUnits(
  //         tx.from[0].amount.amount().toFixed(),
  //         asset.decimals || 18
  //       ),
  //     })),
  //   };
  // };

  return {
    addPendingTx,
    getFullTxs,
    startMonitor,
  };
};

export default EthTransactionController;
