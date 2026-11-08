import {
  compareEvmDappFees,
  type EvmDappFeeAdjustment,
  selectEvmDappFees,
  selectEvmDappGasLimit,
} from '../shared/evmDappFeePolicy';
import { evmCallRequest } from '../shared/evmEstimateRequest';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store from 'state/store';
import { INetwork, KeyringAccountType } from 'types/network';
import { IFeeState, ITransactionParams } from 'types/transactions';
import { BigNumber } from 'utils/ethersV6Compat';
import {
  EVM_TRANSACTION_CONTEXT_CHANGED,
  IEvmTransactionContext,
} from 'utils/evmTransactionContext';

import { safeBigNumber } from './safeBigNumber';
import {
  prepareSmartAccountFeeQuote,
  type SmartAccountFeeOverrides,
} from './smartAccount/execution';

const toGweiNumber = (value: BigNumber) => Number(value.toString()) / 1e9;
const rpcHex = (value: BigNumber) =>
  `0x${BigInt(value.toString()).toString(16)}`;

// RPC quantities and approved transaction fields must not turn into a default
// fee or gas limit when missing, malformed, or inexact.
const quantity = (value: unknown, label: string): BigNumber => {
  // Chrome's controller messaging uses JSON serialization. SDK BigNumbers
  // therefore arrive as their toJSON() shape, not live class instances.
  // Decode only that tagged hex representation, then apply the same bounded
  // quantity checks below; never coerce arbitrary objects into default fees.
  if (
    value !== null &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'BigNumber'
  ) {
    const hex = (value as { hex?: unknown }).hex;
    if (typeof hex !== 'string' || !/^0x[\da-f]+$/i.test(hex))
      throw new Error(`Invalid ${label}`);
    value = hex;
  }
  if (
    !BigNumber.isBigNumber(value) &&
    !(
      (typeof value === 'number' && Number.isSafeInteger(value)) ||
      (typeof value === 'string' &&
        /^(?:0x[\da-f]+|\d+)$/i.test(value) &&
        value.length <= 80)
    )
  )
    throw new Error(`Invalid ${label}`);
  const parsed = BigNumber.from(value);
  if (parsed.lt(0) || parsed.gt(BigNumber.from(2).pow(256).sub(1)))
    throw new Error(`Invalid ${label}`);
  return parsed;
};

// Controller messages flatten SDK errors, so retain the integrity sentinel.
// A reply for another RPC request must never become a fallback fee quote.
const isRpcIntegrityError = (error: any) =>
  error?.code === 'SYSWEB3_RPC_RESPONSE_INVALID' ||
  (typeof error?.message === 'string' &&
    error.message.startsWith('[SYSWEB3_RPC_RESPONSE_INVALID]'));

export const fetchGasAndDecodeFunction = async (
  dataTx: ITransactionParams,
  activeNetwork: INetwork,
  approvedContext?: IEvmTransactionContext,
  smartAccountFeeOverrides?: SmartAccountFeeOverrides
) => {
  // Safety check: this function is only for EVM networks
  const { vault, vaultGlobal } = store.getState();
  const { isBitcoinBased } = vault;
  if (isBitcoinBased) {
    throw new Error(
      'fetchGasAndDecodeFunction is not available on UTXO networks'
    );
  }
  const account =
    vault.accounts[vault.activeAccount.type]?.[vault.activeAccount.id];
  if (!account?.address) throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
  const expectedContext: IEvmTransactionContext = approvedContext || {
    account: {
      address: account.address,
      id: vault.activeAccount.id,
      type: vault.activeAccount.type,
    },
    chainId: activeNetwork.chainId,
    rpcUrl: activeNetwork.url,
    slip44: vaultGlobal.activeSlip44,
  };
  const assertCurrentContext = () => {
    const { vault: current, vaultGlobal: currentGlobal } = store.getState();
    const currentAccount =
      current.accounts[current.activeAccount.type]?.[current.activeAccount.id];
    const unsupportedNonce =
      dataTx.nonce !== undefined &&
      (currentAccount?.isLedgerWallet ||
        currentAccount?.isTrezorWallet ||
        currentAccount?.isSmartAccount ||
        [
          KeyringAccountType.Ledger,
          KeyringAccountType.Trezor,
          KeyringAccountType.SmartAccount,
        ].includes(current.activeAccount.type));
    const unsupportedAccessList =
      dataTx.accessList?.length &&
      (currentAccount?.isSmartAccount ||
        current.activeAccount.type === KeyringAccountType.SmartAccount);
    if (
      !expectedContext.account.address ||
      current.isBitcoinBased ||
      current.activeNetwork.chainId !== expectedContext.chainId ||
      current.activeNetwork.url !== expectedContext.rpcUrl ||
      activeNetwork.chainId !== expectedContext.chainId ||
      activeNetwork.url !== expectedContext.rpcUrl ||
      currentGlobal.activeSlip44 !== expectedContext.slip44 ||
      current.activeAccount.id !== expectedContext.account.id ||
      current.activeAccount.type !== expectedContext.account.type ||
      currentAccount?.address?.toLowerCase() !==
        expectedContext.account.address.toLowerCase() ||
      (dataTx.from &&
        dataTx.from.toLowerCase() !==
          expectedContext.account.address.toLowerCase()) ||
      (dataTx.chainId !== undefined &&
        BigInt(dataTx.chainId) !== BigInt(expectedContext.chainId)) ||
      unsupportedNonce ||
      unsupportedAccessList
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
  };
  assertCurrentContext();
  let blockData: any;
  try {
    blockData = await controllerEmitter(
      ['wallet', 'ethereumTransaction', 'web3Provider', 'send'],
      ['eth_getBlockByNumber', ['pending', false]]
    );
  } catch (error) {
    assertCurrentContext();
    throw error;
  }
  assertCurrentContext();
  if (!blockData || typeof blockData !== 'object')
    throw new Error('Invalid pending block fee data');
  const blockGasLimit = quantity(blockData.gasLimit, 'pending block gas limit');
  if (blockGasLimit.isZero())
    throw new Error('Invalid pending block gas limit');
  const baseFee =
    blockData.baseFeePerGas === undefined || blockData.baseFeePerGas === null
      ? null
      : quantity(blockData.baseFeePerGas, 'pending block base fee');

  let isInvalidTxData = false;

  const gasLimitError = false;

  // Get fee data - backend already handles EIP-1559 detection
  let feeData: any;
  try {
    feeData = await controllerEmitter([
      'wallet',
      'ethereumTransaction',
      'getFeeDataWithDynamicMaxPriorityFeePerGas',
    ]);
  } catch (error) {
    assertCurrentContext();
    throw error;
  }
  assertCurrentContext();

  const networkGasPrice = quantity(feeData?.gasPrice, 'network gas price');
  // Pre-London providers may return gasPrice alone or null EIP-1559 fields.
  // Only an actually absent pending base fee permits that legacy shape;
  // present or malformed London caps must still be validated, never defaulted.
  const networkMaxFeePerGas =
    !baseFee &&
    (feeData?.maxFeePerGas === undefined || feeData?.maxFeePerGas === null)
      ? BigNumber.from(0)
      : quantity(feeData?.maxFeePerGas, 'network maxFeePerGas');
  const networkMaxPriorityFeePerGas =
    !baseFee &&
    (feeData?.maxPriorityFeePerGas === undefined ||
      feeData?.maxPriorityFeePerGas === null)
      ? BigNumber.from(0)
      : quantity(feeData?.maxPriorityFeePerGas, 'network maxPriorityFeePerGas');
  if (
    networkMaxPriorityFeePerGas.gt(networkMaxFeePerGas) ||
    (baseFee && networkMaxFeePerGas.lt(baseFee)) ||
    (!baseFee &&
      ((feeData?.baseFeePerGas !== undefined &&
        feeData?.baseFeePerGas !== null) ||
        !networkMaxFeePerGas.isZero() ||
        !networkMaxPriorityFeePerGas.isZero()))
  )
    throw new Error('Inconsistent network fee data');

  const dappMaxFeePerGas =
    dataTx?.maxFeePerGas !== undefined
      ? quantity(dataTx.maxFeePerGas, 'dApp maxFeePerGas')
      : null;
  const dappMaxPriorityFeePerGas =
    dataTx?.maxPriorityFeePerGas !== undefined
      ? quantity(dataTx.maxPriorityFeePerGas, 'dApp maxPriorityFeePerGas')
      : null;
  const dappGasPrice =
    dataTx?.gasPrice !== undefined
      ? quantity(dataTx.gasPrice, 'dApp gasPrice')
      : null;

  const selectedFees = selectEvmDappFees(
    {
      ...(dataTx.type === undefined
        ? {}
        : { type: Number(BigInt(dataTx.type)) as 0 | 2 }),
      ...(dappGasPrice === null ? {} : { gasPrice: dappGasPrice.toBigInt() }),
      ...(dappMaxFeePerGas === null
        ? {}
        : { maxFeePerGas: dappMaxFeePerGas.toBigInt() }),
      ...(dappMaxPriorityFeePerGas === null
        ? {}
        : { maxPriorityFeePerGas: dappMaxPriorityFeePerGas.toBigInt() }),
      hasAccessList: dataTx.accessList !== undefined,
    },
    {
      gasPrice: networkGasPrice.toBigInt(),
      maxFeePerGas: networkMaxFeePerGas.toBigInt(),
      maxPriorityFeePerGas: networkMaxPriorityFeePerGas.toBigInt(),
      ...(baseFee === null ? {} : { baseFeePerGas: baseFee.toBigInt() }),
    }
  );
  const isLegacyTransaction = selectedFees.type === 0;
  const legacyGasPrice = BigNumber.from(
    selectedFees.type === 0 ? selectedFees.gasPrice : networkGasPrice
  );
  const maxFeePerGas = BigNumber.from(
    selectedFees.type === 2 ? selectedFees.maxFeePerGas : legacyGasPrice
  );
  const maxPriorityFeePerGas = BigNumber.from(
    selectedFees.type === 2 ? selectedFees.maxPriorityFeePerGas : legacyGasPrice
  );

  const nonce =
    dataTx.nonce !== undefined
      ? BigNumber.from(dataTx.nonce).toNumber()
      : ((await controllerEmitter(
          ['wallet', 'getRecommendedEvmNonce'],
          [dataTx.from]
        )) as number);
  assertCurrentContext();
  // Preserve the transaction type based on what dApp sent
  const formTx: {
    accessList?: ITransactionParams['accessList'];
    chainId: number;
    data: string;
    from: string;
    gasLimit: BigNumber;
    gasPrice?: string;
    maxFeePerGas: BigNumber;
    maxPriorityFeePerGas: BigNumber;
    nonce: number;
    to: string;
    type?: ITransactionParams['type'];
    value: any; // BigNumber or compatible type
  } = {
    ...(dataTx.accessList !== undefined
      ? { accessList: dataTx.accessList }
      : {}),
    ...(dataTx.type !== undefined ? { type: dataTx.type } : {}),
    data: dataTx.data,
    from: dataTx.from,
    to: dataTx.to,
    value: dataTx?.value
      ? safeBigNumber(dataTx.value, '0x0', 'tx value')
      : BigNumber.from(0),
    nonce: nonce,
    chainId: expectedContext.chainId,
    gasLimit: BigNumber.from(0), //todo: adjust to get from new keyringmanager
    // Always initialize these fields, will be overwritten below
    maxFeePerGas: BigNumber.from(0),
    maxPriorityFeePerGas: BigNumber.from(0),
  };

  // If dApp sent gasPrice, make it a Type 0 (legacy) transaction
  if (isLegacyTransaction) {
    formTx.gasPrice = legacyGasPrice.toString();
    // For legacy transactions, set EIP-1559 fields to gasPrice value for compatibility
    formTx.maxPriorityFeePerGas = legacyGasPrice;
    formTx.maxFeePerGas = legacyGasPrice;
  } else {
    // Otherwise make it Type 2 (EIP-1559) transaction
    formTx.maxPriorityFeePerGas = maxPriorityFeePerGas;
    formTx.maxFeePerGas = maxFeePerGas;
  }

  const baseTx = evmCallRequest({
    ...(dataTx.accessList === undefined
      ? {}
      : { accessList: dataTx.accessList }),
    from: dataTx.from,
    to: dataTx.to || null,
    value: formTx.value.toString(),
    data: dataTx.data,
    nonce: String(nonce),
  });
  // Check if dataTx.gas or dataTx.gasLimit is provided and is a valid non-zero value
  let providedValue: BigNumber | null = null;

  // Do not let malformed or oversized app gas become a replacement estimate.
  if (dataTx.gasLimit !== undefined && dataTx.gasLimit !== null) {
    providedValue = quantity(dataTx.gasLimit, 'transaction gas limit');
  } else if (dataTx.gas !== undefined && dataTx.gas !== null) {
    providedValue = quantity(dataTx.gas, 'transaction gas limit');
  }
  if (
    providedValue &&
    (!Number.isSafeInteger(Number(providedValue.toString())) ||
      providedValue.isZero())
  )
    throw new Error('Invalid transaction gas limit');

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
      delete clonedTx.gasPrice;
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
    assertCurrentContext();
    if (isRpcIntegrityError(error)) throw error;
    if (!error.message.includes('reverted')) {
      isInvalidTxData = true;
    }
  }
  assertCurrentContext();

  let estimatedGasLimit: BigNumber;
  try {
    // if tx data is valid, Pali is able to estimate gas.
    if (!isInvalidTxData) {
      // The SDK's getTxGasLimit adds a margin and may return fallback gas.
      // Use only an actual correlated, successful raw estimate as evidence
      // that an app-provided gas limit is sufficient for this exact call.
      estimatedGasLimit = quantity(
        await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'web3Provider', 'send'],
          ['eth_estimateGas', [baseTx]]
        ),
        'transaction gas limit'
      );
    } else throw new Error('Cannot estimate invalid transaction data');
  } catch (error) {
    assertCurrentContext();
    throw error;
  }
  assertCurrentContext();

  formTx.gasLimit = BigNumber.from(
    selectEvmDappGasLimit(
      estimatedGasLimit.toBigInt(),
      providedValue?.toBigInt(),
      BigInt(expectedContext.chainId),
      blockGasLimit.toBigInt()
    )
  );

  // Check if this is a legacy transaction

  // Fee editing uses numeric gas limits. Refuse an inexact or overflowing
  // quote before it reaches rendering or can change the gas the user approves.
  const finalGasLimitNumber = Number(formTx.gasLimit.toString());
  if (!Number.isSafeInteger(finalGasLimitNumber) || finalGasLimitNumber <= 0) {
    throw new Error('Invalid transaction gas limit');
  }

  const feeDetails: IFeeState = {
    gasLimit: finalGasLimitNumber,
    minimumGasLimit: Number(estimatedGasLimit.toString()),
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

    feeDetails.baseFee = toGweiNumber(baseFee!);
  }

  if (
    account.isSmartAccount ||
    vault.activeAccount.type === KeyringAccountType.SmartAccount
  ) {
    // The direct call's gas remains a standard dapp field. It is not the
    // EntryPoint account-charge bound: verification/signature calldata and
    // deployment gas must come from the same AA preparer used by submission.
    const feeOverrides: SmartAccountFeeOverrides =
      smartAccountFeeOverrides ||
      (isLegacyTransaction
        ? { gasPrice: formTx.gasPrice! }
        : {
            maxFeePerGas: formTx.maxFeePerGas.toString(),
            maxPriorityFeePerGas: formTx.maxPriorityFeePerGas.toString(),
          });
    const execution = {
      target: formTx.to,
      data: formTx.data || '0x',
      value: rpcHex(formTx.value),
    };
    feeDetails.smartAccountFeeQuote = await prepareSmartAccountFeeQuote({
      accountAddress: expectedContext.account.address,
      accountId: vault.activeAccount.id,
      controllerEmitter,
      executions: [execution],
      expectedContext,
      feeOverrides,
      maximumGasUnits: blockGasLimit.toString(),
    });
    assertCurrentContext();
  }

  const comparison = compareEvmDappFees(
    {
      ...(providedValue ? { gasLimit: providedValue.toBigInt() } : {}),
      ...(dappGasPrice ? { gasPrice: dappGasPrice.toBigInt() } : {}),
      ...(dappMaxFeePerGas
        ? { maxFeePerGas: dappMaxFeePerGas.toBigInt() }
        : {}),
      ...(dappMaxPriorityFeePerGas
        ? { maxPriorityFeePerGas: dappMaxPriorityFeePerGas.toBigInt() }
        : {}),
    },
    { ...selectedFees, gasLimit: formTx.gasLimit.toBigInt() },
    estimatedGasLimit.toBigInt(),
    {
      gasPrice: networkGasPrice.toBigInt(),
      maxFeePerGas: networkMaxFeePerGas.toBigInt(),
      maxPriorityFeePerGas: networkMaxPriorityFeePerGas.toBigInt(),
    }
  );
  const presentation = (
    value: EvmDappFeeAdjustment | undefined,
    divisor: number
  ) =>
    value && {
      requested: Number(value.requested) / divisor,
      recommended: Number(value.recommended) / divisor,
    };
  return {
    feeDetails,
    feeSafety: {
      gasLimit: presentation(comparison.gasLimit, 1),
      gasPrice: presentation(comparison.gasPrice, 1e9),
      maxFeePerGas: presentation(comparison.maxFeePerGas, 1e9),
      maxPriorityFeePerGas: presentation(comparison.maxPriorityFeePerGas, 1e9),
    },
    recommendationOnly: comparison.recommendationOnly,
    formTx,
    nonce,
    isInvalidTxData,
    gasLimitError,
  };
};
