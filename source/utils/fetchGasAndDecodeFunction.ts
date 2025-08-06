import { BigNumber } from '@ethersproject/bignumber';
import { Block } from '@ethersproject/providers';

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
  const blockData = await controllerEmitter(['wallet', 'getCurrentBlock'], []);
  const currentBlock = blockData as Block;

  const gasLimitFromCurrentBlock = Math.floor(
    Number(currentBlock.gasLimit) * 0.95
  ); //GasLimit from current block with 5% discount, whole limit from block is too much

  let gasLimitResult = BigNumber.from(gasLimitFromCurrentBlock);

  let isInvalidTxData = false;

  let gasLimitError = false;

  // Get fee data - backend already handles EIP-1559 detection
  const feeData = (await controllerEmitter([
    'wallet',
    'ethereumTransaction',
    'getFeeDataWithDynamicMaxPriorityFeePerGas',
  ])) as any;

  // Use dApp values if provided, otherwise use network values
  const maxFeePerGas = dataTx?.maxFeePerGas
    ? safeBigNumber(dataTx.maxFeePerGas, '0x77359400', 'dApp maxFeePerGas')
    : dataTx?.gasPrice
    ? safeBigNumber(dataTx.gasPrice, '0x77359400', 'dApp gasPrice') // Convert legacy gasPrice to maxFeePerGas for UI
    : safeBigNumber(
        feeData?.maxFeePerGas,
        '0x77359400',
        'network maxFeePerGas'
      ); // 2 Gwei fallback

  const maxPriorityFeePerGas = dataTx?.maxPriorityFeePerGas
    ? safeBigNumber(
        dataTx.maxPriorityFeePerGas,
        '0x3b9aca00',
        'dApp maxPriorityFeePerGas'
      )
    : dataTx?.gasPrice
    ? safeBigNumber(dataTx.gasPrice, '0x3b9aca00', 'dApp gasPrice for priority') // For legacy, priority = gas price
    : safeBigNumber(
        feeData?.maxPriorityFeePerGas,
        '0x3b9aca00',
        'network maxPriorityFeePerGas'
      ); // 1 Gwei fallback

  const nonce = (await controllerEmitter(
    ['wallet', 'ethereumTransaction', 'getRecommendedNonce'],
    [dataTx.from]
  )) as number; // This also need possibility for customization //todo: adjust to get from new keyringmanager

  // Preserve the transaction type based on what dApp sent
  const formTx: {
    chainId: number;
    data: string;
    from: string;
    gasLimit: BigNumber;
    gasPrice?: string;
    maxFeePerGas: BigNumber;
    maxPriorityFeePerGas: BigNumber;
    nonce: number;
    to: string;
    value: number;
  } = {
    data: dataTx.data,
    from: dataTx.from,
    to: dataTx.to,
    value: dataTx?.value ? Number(dataTx.value) : 0,
    nonce: nonce,
    chainId: activeNetwork.chainId,
    gasLimit: BigNumber.from(0), //todo: adjust to get from new keyringmanager
    // Always initialize these fields, will be overwritten below
    maxFeePerGas: BigNumber.from(0),
    maxPriorityFeePerGas: BigNumber.from(0),
  };

  // If dApp sent gasPrice, make it a Type 0 (legacy) transaction
  if (dataTx?.gasPrice && !dataTx?.maxFeePerGas) {
    formTx.gasPrice = String(dataTx.gasPrice);
    // For legacy transactions, set EIP-1559 fields to gasPrice value for compatibility
    const gasPriceBN = BigNumber.from(dataTx.gasPrice);
    formTx.maxPriorityFeePerGas = gasPriceBN;
    formTx.maxFeePerGas = gasPriceBN;
  } else {
    // Otherwise make it Type 2 (EIP-1559) transaction
    formTx.maxPriorityFeePerGas = dataTx?.maxPriorityFeePerGas
      ? BigNumber.from(dataTx.maxPriorityFeePerGas)
      : maxPriorityFeePerGas;
    formTx.maxFeePerGas = dataTx?.maxFeePerGas
      ? BigNumber.from(dataTx.maxFeePerGas)
      : maxFeePerGas;
  }

  const baseTx = {
    from: dataTx.from,
    to: dataTx.to,
    value: dataTx?.value ? dataTx.value : 0,
    data: dataTx.data,
    nonce: nonce,
  } as any;
  // Check if dataTx.gas or dataTx.gasLimit is provided and is a valid non-zero value
  let providedValue: BigNumber | null = null;
  let shouldEstimateGas = true;

  // Try to get gas limit from either gas or gasLimit field (handles hex strings like "0x5208")
  if (dataTx.gasLimit !== undefined && dataTx.gasLimit !== null) {
    try {
      providedValue = BigNumber.from(dataTx.gasLimit);
      shouldEstimateGas = providedValue.lte(0);
    } catch (e) {
      shouldEstimateGas = true;
    }
  } else if (dataTx.gas !== undefined && dataTx.gas !== null) {
    try {
      providedValue = BigNumber.from(dataTx.gas);
      shouldEstimateGas = providedValue.lte(0);
    } catch (e) {
      shouldEstimateGas = true;
    }
  }

  if (shouldEstimateGas) {
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
  } else {
    // Use the provided gas value if it's valid
    gasLimitResult = providedValue!; // We know it's not null if shouldEstimateGas is false
  }

  // Set the gas limit based on our estimation or provided value
  // Use block gas limit as primary fallback
  const gasLimitWithFallback = safeBigNumber(
    gasLimitResult,
    gasLimitFromCurrentBlock,
    'Gas limit'
  );

  // Determine minimum gas based on transaction type
  // Simple ETH transfers (no data) need 42,000 gas
  // Contract interactions need more (use 60,000 as default minimum)
  const isSimpleTransfer =
    !dataTx.data || dataTx.data === '0x' || dataTx.data === '0x0';
  const minimumGas = isSimpleTransfer ? 42000 : 60000;

  // Ensure we have at least the minimum gas for the transaction type
  formTx.gasLimit = gasLimitWithFallback.lt(minimumGas)
    ? BigNumber.from(minimumGas)
    : gasLimitWithFallback;

  // Check if this is a legacy transaction
  const isLegacyTransaction = dataTx?.gasPrice && !dataTx?.maxFeePerGas;

  const gasLimitString = formTx.gasLimit.toString();
  const gasLimitNumber = parseInt(gasLimitString, 10);

  // Ensure we have a valid number
  const finalGasLimitNumber =
    isNaN(gasLimitNumber) || gasLimitNumber === 0
      ? parseInt(formTx.gasLimit.toString(), 10)
      : gasLimitNumber;

  const feeDetails: {
    baseFee: number;
    gasLimit: number;
    gasPrice?: number;
    maxFeePerGas: number;
    maxPriorityFeePerGas: number;
  } = {
    gasLimit: finalGasLimitNumber,
    baseFee: 0, // Will be set below
    maxFeePerGas: 0, // Will be set below
    maxPriorityFeePerGas: 0, // Will be set below
  };

  if (isLegacyTransaction) {
    // For legacy transactions, only set gasPrice
    const gasPriceBigNumber = BigNumber.from(dataTx.gasPrice);
    // Convert wei to Gwei with proper decimal handling
    feeDetails.gasPrice = Number(gasPriceBigNumber.toString()) / 1e9;
    // Legacy transactions don't have EIP-1559 fields, set minimal compatibility values
    // These are needed by the UI to display fee estimates
    feeDetails.baseFee = 0;
    feeDetails.maxFeePerGas = feeDetails.gasPrice;
    feeDetails.maxPriorityFeePerGas = feeDetails.gasPrice;
  } else {
    // For EIP-1559 transactions
    // Convert wei to Gwei with proper decimal handling
    // Instead of integer division, convert to number first then divide
    feeDetails.maxFeePerGas = Number(maxFeePerGas.toString()) / 1e9;
    feeDetails.maxPriorityFeePerGas =
      Number(maxPriorityFeePerGas.toString()) / 1e9;

    // Calculate baseFee
    const baseFeeCalc = maxFeePerGas.gt(maxPriorityFeePerGas)
      ? maxFeePerGas.sub(maxPriorityFeePerGas)
      : BigNumber.from(0);
    feeDetails.baseFee = Number(baseFeeCalc.toString()) / 1e9;
  }

  return {
    feeDetails,
    formTx,
    nonce,
    isInvalidTxData,
    gasLimitError,
  };
};
