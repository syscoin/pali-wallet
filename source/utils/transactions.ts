import { ethers } from 'ethers';
import { isInteger, omit } from 'lodash';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { IEvmTransactionResponse } from 'scripts/Background/controllers/transactions/types';
import { IMainController } from 'types/controllers';
import { ITransactionParams, ITxState } from 'types/transactions';

import { formatCurrency, truncate } from './format';

export const getAssetBalance = (
  asset: any,
  activeAccount: IKeyringAccountState,
  isBitcoinBased: boolean
) => {
  if (!isBitcoinBased) {
    const value = Number(
      asset.tokenSymbol === 'ETH'
        ? activeAccount.balances.ethereum
        : asset.balance
    );

    return `${isInteger(value) ? value : value.toFixed(2)} ${
      asset.tokenSymbol
    }`;
  }

  const formattedBalance = truncate(
    formatCurrency(
      String(+asset.balance / 10 ** asset.decimals),
      asset.decimals
    ),
    14
  );

  return `${formattedBalance} ${asset.symbol}`;
};

export const omitTransactionObjectData = (
  transaction: ITxState | ITransactionParams,
  omitArray: Array<string>
) => omit(transaction, omitArray);

// eslint-disable-next-line no-shadow
export enum UpdateTxAction {
  Cancel = 'cancel',
  SpeedUp = 'speedUp',
}

const cancelTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  wallet: IMainController,
  alert: any
) => {
  const { isCanceled, error } =
    await wallet.ethereumTransaction.cancelSentTransaction(txHash, isLegacy);

  if (!isCanceled && error) {
    alert.removeAll();
    alert.error(
      'Transaction not found or already confirmed, verify the transaction in the explorer!'
    );

    return;
  }

  switch (isCanceled) {
    case true:
      wallet.setEvmTransactionAsCanceled(txHash, chainId);
      alert.removeAll();
      alert.success('Your transaction was successfully canceled.');
      break;
    case false:
      alert.removeAll();
      alert.error(
        'Something went wrong when trying to cancel your Transaction, please try again later!'
      );
      break;
  }
};

const speedUpTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  wallet: IMainController,
  alert: any
) => {
  const { isSpeedUp, error, transaction } =
    await wallet.ethereumTransaction.sendTransactionWithEditedFee(
      txHash,
      isLegacy
    );

  if (!isSpeedUp && error) {
    alert.removeAll();
    alert.error(
      'Transaction not found or already confirmed, verify the transaction in the explorer!'
    );

    return;
  }

  switch (isSpeedUp) {
    case true:
      wallet.setEvmTransactionAsAccelerated(txHash, chainId, transaction);
      alert.removeAll();
      alert.success('Your transaction was successfully accelerated.');
      break;
    case false:
      alert.removeAll();
      alert.error(
        'Something went wrong when trying to speed up your Transaction, please try again later!'
      );
      break;
  }
};

export const handleUpdateTransaction = async ({
  updateData,
}: {
  updateData: {
    alert: any;
    chainId: number;
    isLegacy: boolean;
    txHash: string;
    updateType: UpdateTxAction;
    wallet: IMainController;
  };
}) => {
  const { alert, chainId, isLegacy, txHash, updateType, wallet } = updateData;

  switch (updateType) {
    case UpdateTxAction.Cancel:
      return await cancelTransaction(txHash, isLegacy, chainId, wallet, alert);
    case UpdateTxAction.SpeedUp:
      return await speedUpTransaction(txHash, isLegacy, chainId, wallet, alert);
  }
};

export const isERC1155Transfer = (tx: IEvmTransactionResponse) => {
  const safeTransferFromSelector = ethers.utils
    .id('safeTransferFrom(address,address,uint256,uint256,bytes)')
    .slice(0, 10);

  if (tx?.input) {
    return tx.input.startsWith(safeTransferFromSelector);
  }

  return false;
};

export const isERC20Transfer = (tx: IEvmTransactionResponse) => {
  const transferSelector = ethers.utils
    .id('transfer(address,uint256)')
    .slice(0, 10);
  const transferFromSelector = ethers.utils
    .id('transferFrom(address,address,uint256)')
    .slice(0, 10);

  if (tx?.input) {
    return (
      tx.input.startsWith(transferSelector) ||
      tx.input.startsWith(transferFromSelector)
    );
  }

  return false;
};

export const isTokenTransfer = (tx: IEvmTransactionResponse) =>
  isERC20Transfer(tx) || isERC1155Transfer(tx);
