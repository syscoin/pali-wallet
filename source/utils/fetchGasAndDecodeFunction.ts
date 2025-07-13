import { BigNumber } from 'ethers';

import { INetwork } from '@pollum-io/sysweb3-network';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store from 'state/store';
import { ITransactionParams } from 'types/transactions';

export const fetchGasAndDecodeFunction = async (
  dataTx: ITransactionParams,
  activeNetwork: INetwork
) => {
  // Safety check: this function is only for EVM networks
  const { isBitcoinBased } = store.getState().vault;
  if (isBitcoinBased) {
    throw new Error(
      'fetchGasAndDecodeFunction is not available on UTXO networks'
    );
  }

  const currentBlock = (await controllerEmitter(
    ['wallet', 'ethereumTransaction', 'web3Provider', 'send'],
    ['eth_getBlockByNumber', ['latest', false]]
  )) as any;

  const gasLimitFromCurrentBlock = Math.floor(
    Number(currentBlock.gasLimit) * 0.95
  ); //GasLimit from current block with 5% discount, whole limit from block is too much

  let gasLimitResult = BigNumber.from(gasLimitFromCurrentBlock);

  let isInvalidTxData = false;

  let gasLimitError = false;

  const { maxFeePerGas, maxPriorityFeePerGas } = (await controllerEmitter([
    'wallet',
    'ethereumTransaction',
    'getFeeDataWithDynamicMaxPriorityFeePerGas',
  ]).then((res: any) => ({
    maxFeePerGas: BigNumber.from(res.maxFeePerGas),
    maxPriorityFeePerGas: BigNumber.from(res.maxPriorityFeePerGas),
  }))) as any; //todo: adjust to get from new keyringmanager

  const nonce = (await controllerEmitter(
    ['wallet', 'ethereumTransaction', 'getRecommendedNonce'],
    [dataTx.from]
  )) as number; // This also need possibility for customization //todo: adjust to get from new keyringmanager

  const formTx = {
    data: dataTx.data,
    from: dataTx.from,
    to: dataTx.to,
    value: dataTx?.value ? dataTx.value : 0,
    maxPriorityFeePerGas: dataTx?.maxPriorityFeePerGas
      ? dataTx.maxPriorityFeePerGas
      : maxPriorityFeePerGas,
    maxFeePerGas: dataTx?.maxFeePerGas ? dataTx?.maxFeePerGas : maxFeePerGas,
    nonce: nonce,
    chainId: activeNetwork.chainId,
    gasLimit: BigNumber.from(0), //todo: adjust to get from new keyringmanager
  };

  const baseTx = {
    from: dataTx.from,
    to: dataTx.to,
    value: dataTx?.value ? dataTx.value : 0,
    data: dataTx.data,
    nonce: nonce,
  } as any;

  if (dataTx.gas) {
    gasLimitResult = BigNumber.from(0);
  } else {
    // verify tx data
    try {
      // if it run successfully, the contract data is all right.
      const clonedTx = { ...dataTx };
      delete clonedTx.gasLimit;
      delete clonedTx.gas;
      delete clonedTx.maxPriorityFeePerGas;
      delete clonedTx.maxFeePerGas;
      if (!dataTx.to) {
        delete clonedTx.to;
      }
      await controllerEmitter(
        ['wallet', 'ethereumTransaction', 'web3Provider', 'send'],
        ['eth_call', [clonedTx, 'latest']]
      );
    } catch (error) {
      if (!error.message.includes('reverted')) {
        isInvalidTxData = true;
      }
    }

    try {
      // if tx data is valid, Pali is able to estimate gas.
      if (!isInvalidTxData) {
        gasLimitResult = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'getTxGasLimit'],
          [baseTx]
        )) as any;
      }
    } catch (error) {
      console.error(error);
      gasLimitError = true;
    }
  }
  formTx.gasLimit =
    (dataTx?.gas && Number(dataTx?.gas) > Number(gasLimitResult)) ||
    (dataTx?.gasLimit && Number(dataTx?.gasLimit) > Number(gasLimitResult))
      ? BigNumber.from(dataTx.gas || dataTx.gasLimit)
      : gasLimitResult;
  const feeDetails = {
    maxFeePerGas: maxFeePerGas.toNumber() / 10 ** 9,
    baseFee: maxFeePerGas.sub(maxPriorityFeePerGas).toNumber() / 10 ** 9,
    maxPriorityFeePerGas: maxPriorityFeePerGas.toNumber() / 10 ** 9,
    gasLimit: formTx.gasLimit.toNumber(),
  };

  return {
    feeDetails,
    formTx,
    nonce,
    isInvalidTxData,
    gasLimitError,
  };
};
