import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store from 'state/store';
import { INetwork } from 'types/network';
import { ITransactionParams } from 'types/transactions';
import { Block } from 'utils/ethersV6Compat';
import { BigNumber } from 'utils/ethersV6Compat';

import { safeBigNumber } from './safeBigNumber';

const maxBigNumber = (left: BigNumber, right: BigNumber) =>
  left.gte(right) ? left : right;

const toGweiNumber = (value: BigNumber) => Number(value.toString()) / 1e9;

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
  let feeData: any;
  try {
    feeData = await controllerEmitter([
      'wallet',
      'ethereumTransaction',
      'getFeeDataWithDynamicMaxPriorityFeePerGas',
    ]);
  } catch (error) {
    console.error('Failed to fetch fee data:', error);
    // Use default fallback values if fee fetch fails
    feeData = {
      maxFeePerGas: BigNumber.from('0x77359400'), // 2 Gwei fallback
      maxPriorityFeePerGas: BigNumber.from('0x3b9aca00'), // 1 Gwei fallback
    };
  }

  const networkMaxFeePerGas = safeBigNumber(
    feeData?.maxFeePerGas || feeData?.gasPrice,
    '0x77359400',
    'network maxFeePerGas'
  ); // 2 Gwei fallback
  const networkMaxPriorityFeePerGas = safeBigNumber(
    feeData?.maxPriorityFeePerGas || feeData?.gasPrice || '0x0',
    '0x3b9aca00',
    'network maxPriorityFeePerGas'
  ); // 1 Gwei fallback
  const networkGasPrice = safeBigNumber(
    feeData?.gasPrice || feeData?.maxFeePerGas,
    '0x77359400',
    'network gasPrice'
  );

  const dappMaxFeePerGas = dataTx?.maxFeePerGas
    ? safeBigNumber(dataTx.maxFeePerGas, '0x77359400', 'dApp maxFeePerGas')
    : null;
  const dappMaxPriorityFeePerGas = dataTx?.maxPriorityFeePerGas
    ? safeBigNumber(
        dataTx.maxPriorityFeePerGas,
        '0x3b9aca00',
        'dApp maxPriorityFeePerGas'
      )
    : null;
  const dappGasPrice = dataTx?.gasPrice
    ? safeBigNumber(dataTx.gasPrice, '0x77359400', 'dApp gasPrice')
    : null;

  let maxFeePerGas = dappMaxFeePerGas
    ? maxBigNumber(dappMaxFeePerGas, networkMaxFeePerGas)
    : dappGasPrice
    ? maxBigNumber(dappGasPrice, networkMaxFeePerGas)
    : networkMaxFeePerGas;
  const maxPriorityFeePerGas = dappMaxPriorityFeePerGas
    ? maxBigNumber(dappMaxPriorityFeePerGas, networkMaxPriorityFeePerGas)
    : dappGasPrice
    ? maxBigNumber(dappGasPrice, networkMaxPriorityFeePerGas)
    : networkMaxPriorityFeePerGas;

  if (maxPriorityFeePerGas.gt(maxFeePerGas)) {
    maxFeePerGas = maxPriorityFeePerGas;
  }

  const legacyGasPrice = dappGasPrice
    ? maxBigNumber(dappGasPrice, networkGasPrice)
    : networkGasPrice;

  const nonce = (await controllerEmitter(
    ['wallet', 'getRecommendedEvmNonce'],
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
    value: any; // BigNumber or compatible type
  } = {
    data: dataTx.data,
    from: dataTx.from,
    to: dataTx.to,
    value: dataTx?.value
      ? safeBigNumber(dataTx.value, '0x0', 'tx value')
      : BigNumber.from(0),
    nonce: nonce,
    chainId: activeNetwork.chainId,
    gasLimit: BigNumber.from(0), //todo: adjust to get from new keyringmanager
    // Always initialize these fields, will be overwritten below
    maxFeePerGas: BigNumber.from(0),
    maxPriorityFeePerGas: BigNumber.from(0),
  };

  // If dApp sent gasPrice, make it a Type 0 (legacy) transaction
  if (dataTx?.gasPrice && !dataTx?.maxFeePerGas) {
    formTx.gasPrice = legacyGasPrice.toString();
    // For legacy transactions, set EIP-1559 fields to gasPrice value for compatibility
    formTx.maxPriorityFeePerGas = legacyGasPrice;
    formTx.maxFeePerGas = legacyGasPrice;
  } else {
    // Otherwise make it Type 2 (EIP-1559) transaction
    formTx.maxPriorityFeePerGas = maxPriorityFeePerGas;
    formTx.maxFeePerGas = maxFeePerGas;
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

  // Try to get gas limit from either gas or gasLimit field (handles hex strings like "0x5208")
  if (dataTx.gasLimit !== undefined && dataTx.gasLimit !== null) {
    try {
      providedValue = BigNumber.from(dataTx.gasLimit);
    } catch (e) {
      providedValue = null;
    }
  } else if (dataTx.gas !== undefined && dataTx.gas !== null) {
    try {
      providedValue = BigNumber.from(dataTx.gas);
    } catch (e) {
      providedValue = null;
    }
  }

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

  let estimatedGasLimit: BigNumber | null = null;
  try {
    // if tx data is valid, Pali is able to estimate gas.
    if (!isInvalidTxData) {
      gasLimitResult = (await controllerEmitter(
        ['wallet', 'ethereumTransaction', 'getTxGasLimit'],
        [baseTx]
      )) as any;

      // Ensure the result from getTxGasLimit is a BigNumber
      estimatedGasLimit = safeBigNumber(
        gasLimitResult,
        gasLimitFromCurrentBlock,
        'Gas limit estimation result'
      );
    }
  } catch (error) {
    console.error(error);
    gasLimitError = true;
  }

  // Determine minimum gas based on transaction type
  // Simple ETH transfers (no data) need 42,000 gas
  // Contract interactions need more (use 60,000 as default minimum)
  const isSimpleTransfer =
    !dataTx.data || dataTx.data === '0x' || dataTx.data === '0x0';
  const minimumGas = isSimpleTransfer ? 42000 : 60000;
  const applyMinimumGas = (gasLimit: BigNumber) =>
    gasLimit.lt(minimumGas) ? BigNumber.from(minimumGas) : gasLimit;

  const estimatedGasLimitWithMinimum = estimatedGasLimit
    ? applyMinimumGas(estimatedGasLimit)
    : null;
  const providedGasLimitWithMinimum =
    providedValue && providedValue.gt(0)
      ? applyMinimumGas(providedValue)
      : null;
  const fallbackGasLimit = applyMinimumGas(
    safeBigNumber(gasLimitResult, gasLimitFromCurrentBlock, 'Gas limit')
  );

  formTx.gasLimit =
    estimatedGasLimitWithMinimum && providedGasLimitWithMinimum
      ? maxBigNumber(providedGasLimitWithMinimum, estimatedGasLimitWithMinimum)
      : providedGasLimitWithMinimum ||
        estimatedGasLimitWithMinimum ||
        fallbackGasLimit;

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
    // Convert wei to Gwei with proper decimal handling
    feeDetails.gasPrice = toGweiNumber(legacyGasPrice);
    // Legacy transactions don't have EIP-1559 fields, set minimal compatibility values
    // These are needed by the UI to display fee estimates
    feeDetails.baseFee = 0;
    feeDetails.maxFeePerGas = feeDetails.gasPrice;
    feeDetails.maxPriorityFeePerGas = feeDetails.gasPrice;
  } else {
    // For EIP-1559 transactions
    // Convert wei to Gwei with proper decimal handling
    // Instead of integer division, convert to number first then divide
    feeDetails.maxFeePerGas = toGweiNumber(maxFeePerGas);
    feeDetails.maxPriorityFeePerGas = toGweiNumber(maxPriorityFeePerGas);

    // Calculate baseFee
    const baseFeeCalc = maxFeePerGas.gt(maxPriorityFeePerGas)
      ? maxFeePerGas.sub(maxPriorityFeePerGas)
      : BigNumber.from(0);
    feeDetails.baseFee = Number(baseFeeCalc.toString()) / 1e9;
  }

  return {
    feeDetails,
    feeSafety: {
      gasLimit:
        providedValue &&
        estimatedGasLimitWithMinimum &&
        providedValue.lt(estimatedGasLimitWithMinimum)
          ? {
              requested: parseInt(providedValue.toString(), 10),
              recommended: parseInt(
                estimatedGasLimitWithMinimum.toString(),
                10
              ),
            }
          : undefined,
      gasPrice:
        isLegacyTransaction && dappGasPrice && dappGasPrice.lt(networkGasPrice)
          ? {
              requested: toGweiNumber(dappGasPrice),
              recommended: toGweiNumber(networkGasPrice),
            }
          : undefined,
      maxFeePerGas:
        !isLegacyTransaction &&
        dappMaxFeePerGas &&
        dappMaxFeePerGas.lt(networkMaxFeePerGas)
          ? {
              requested: toGweiNumber(dappMaxFeePerGas),
              recommended: toGweiNumber(networkMaxFeePerGas),
            }
          : undefined,
      maxPriorityFeePerGas:
        !isLegacyTransaction &&
        dappMaxPriorityFeePerGas &&
        dappMaxPriorityFeePerGas.lt(networkMaxPriorityFeePerGas)
          ? {
              requested: toGweiNumber(dappMaxPriorityFeePerGas),
              recommended: toGweiNumber(networkMaxPriorityFeePerGas),
            }
          : undefined,
    },
    formTx,
    nonce,
    isInvalidTxData,
    gasLimitError,
  };
};
