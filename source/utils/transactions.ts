import { ethers } from 'ethers';
import { isInteger, omit } from 'lodash';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { IEvmTransactionResponse } from 'scripts/Background/controllers/transactions/types';
import store from 'state/store';
import { ITransactionParams, ITxState } from 'types/transactions';

import { formatCurrency, truncate } from './format';

export const getAssetBalance = (
  asset: any,
  activeAccount: IKeyringAccountState,
  isBitcoinBased: boolean,
  activeNetwork: { currency: string }
) => {
  if (!isBitcoinBased) {
    const networkCurrency = activeNetwork.currency.toLowerCase();
    const value = Number(
      asset.tokenSymbol?.toLowerCase() === networkCurrency
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
  alert: any
) => {
  // Safety check: this function is only for EVM networks
  const { isBitcoinBased } = store.getState().vault;
  if (isBitcoinBased) {
    alert.removeAll();
    alert.error('Transaction cancellation is not available on UTXO networks');
    return;
  }

  await controllerEmitter(
    ['wallet', 'ethereumTransaction', 'cancelSentTransaction'],
    [txHash, isLegacy]
  ).then((response: { error: boolean; isCanceled: boolean }) => {
    const { isCanceled, error } = response;

    if (!isCanceled && error) {
      alert.removeAll();
      alert.warning(
        'Transaction not found or already confirmed, verify the transaction in the explorer!'
      );

      return;
    }

    switch (isCanceled) {
      case true:
        controllerEmitter(
          ['wallet', 'setEvmTransactionAsCanceled'],
          [txHash, chainId]
        );
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
  });
};

const speedUpTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  alert: any
) => {
  // Safety check: this function is only for EVM networks
  const { isBitcoinBased } = store.getState().vault;
  if (isBitcoinBased) {
    alert.removeAll();
    alert.error('Transaction speed up is not available on UTXO networks');
    return;
  }

  // ethers.providers.TransactionResponse
  await controllerEmitter(
    ['wallet', 'ethereumTransaction', 'sendTransactionWithEditedFee'],
    [txHash, isLegacy]
  ).then(
    (response: {
      error: boolean;
      isSpeedUp: boolean;
      transaction: IEvmTransactionResponse;
    }) => {
      const { isSpeedUp, error, transaction } = response;

      if (!isSpeedUp && error) {
        alert.removeAll();
        alert.warning(
          'Transaction not found or already confirmed, verify the transaction in the explorer!'
        );

        return;
      }

      switch (isSpeedUp) {
        case true:
          controllerEmitter(
            ['wallet', 'setEvmTransactionAsAccelerated'],
            [txHash, chainId, transaction]
          );
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
    }
  );
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
  };
}) => {
  const { alert, chainId, isLegacy, txHash, updateType } = updateData;

  switch (updateType) {
    case UpdateTxAction.Cancel:
      return await cancelTransaction(txHash, isLegacy, chainId, alert);
    case UpdateTxAction.SpeedUp:
      return await speedUpTransaction(txHash, isLegacy, chainId, alert);
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

export const getERC20TransferValue = (tx: IEvmTransactionResponse) => {
  const transferMethodSignature = ethers.utils
    .id('transfer(address,uint256)')
    .slice(0, 10);
  const transferFromMethodSignature = ethers.utils
    .id('transferFrom(address,address,uint256)')
    .slice(0, 10);

  if (tx?.input) {
    if (tx.input.startsWith(transferMethodSignature)) {
      const decodedInput = ethers.utils.defaultAbiCoder.decode(
        ['address', 'uint256'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[1]; // the second element is the value transferred
    } else if (tx.input.startsWith(transferFromMethodSignature)) {
      const decodedInput = ethers.utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[2]; // the third element is the value transferred
    }
  }

  return null; // return null if the transaction is not a token transfer
};
