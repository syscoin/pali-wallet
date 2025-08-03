import { BigNumber } from '@ethersproject/bignumber';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store from 'state/store';
import { INetwork } from 'types/network';
import { ITransactionParams } from 'types/transactions';

import { safeBigNumber } from './safeBigNumber';

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
      // Skip eth_call validation for simple ETH transfers (no data)
      const isSimpleTransfer =
        !dataTx.data || dataTx.data === '0x' || dataTx.data === '0x0';

      if (!isSimpleTransfer) {
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
      }
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

        // Ensure the result from getTxGasLimit is a BigNumber
        gasLimitResult = safeBigNumber(
          gasLimitResult,
          gasLimitFromCurrentBlock,
          'Gas limit estimation result'
        );
      }
    } catch (error) {
      console.error(error);
      gasLimitError = true;
    }
  }
  // Determine the appropriate gas limit
  const userProvidedGasLimit = dataTx?.gas || dataTx?.gasLimit;
  if (userProvidedGasLimit) {
    const userGasLimitBN = safeBigNumber(
      userProvidedGasLimit,
      null,
      'User provided gas limit'
    );
    const gasLimitResultBN = safeBigNumber(
      gasLimitResult,
      gasLimitFromCurrentBlock,
      'Estimated gas limit'
    );

    formTx.gasLimit = userGasLimitBN.gt(gasLimitResultBN)
      ? userGasLimitBN
      : gasLimitResultBN;
  } else {
    formTx.gasLimit = safeBigNumber(
      gasLimitResult,
      gasLimitFromCurrentBlock,
      'Gas limit'
    );
  }

  // Final validation - ensure we have a valid gas limit
  formTx.gasLimit = safeBigNumber(
    formTx.gasLimit,
    60000, // Safe default for contract interactions
    'Final gas limit validation'
  );

  // Get gas price for legacy transactions
  const gasPrice = (await controllerEmitter([
    'wallet',
    'ethereumTransaction',
    'getRecommendedGasPrice',
  ])) as number;

  // Use BigNumber for all calculations to avoid precision loss
  const gweiFactor = BigNumber.from(10).pow(9);

  // Safely convert gas price to BigNumber
  const gasPriceBigNumber = safeBigNumber(
    gasPrice,
    BigNumber.from(10).pow(9), // 1 Gwei fallback
    'Gas price'
  );

  const feeDetails = {
    // Convert to Gwei but keep as string to preserve precision
    maxFeePerGas: parseFloat(maxFeePerGas.div(gweiFactor).toString()),
    baseFee: parseFloat(
      maxFeePerGas.sub(maxPriorityFeePerGas).div(gweiFactor).toString()
    ),
    maxPriorityFeePerGas: parseFloat(
      maxPriorityFeePerGas.div(gweiFactor).toString()
    ),
    gasPrice: parseFloat(gasPriceBigNumber.div(gweiFactor).toString()),
    gasLimit: parseInt(formTx.gasLimit.toString()),
  };

  return {
    feeDetails,
    formTx,
    nonce,
    isInvalidTxData,
    gasLimitError,
  };
};
