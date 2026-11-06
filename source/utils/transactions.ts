import omit from 'lodash/omit';

import { EVM_TRANSACTION_HISTORY_SOURCE } from '../shared/evmHistory';
import {
  getEvmTransactionDisplayInfo,
  isTokenTransfer,
  type EvmTransactionDisplayInfo,
} from '../shared/evmTransactionDisplay';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import type { IEvmTransactionResponse } from 'scripts/Background/controllers/transactions/types';
import store from 'state/store';
import { ITokenDetails } from 'types/tokens';
import { ITransactionParams, ITxState } from 'types/transactions';
import { id } from 'utils/ethersV6Compat';
import { getAddress } from 'utils/ethersV6Compat';
import { defaultAbiCoder } from 'utils/ethersV6Compat';

import { formatCurrency, truncate, formatFullPrecisionBalance } from './format';
import {
  getWalletNavigationScope,
  IWalletNavigationScope,
} from './navigationState';
import type { EvmReplacementFeeApproval } from '@sidhujag/sysweb3-keyring';

export {
  isERC1155Transfer,
  isERC20Transfer,
  isTokenTransfer,
  getERC20TransferValue,
  getERC721TokenId,
  getERC20Recipient,
  getERC1155TransferValue,
  getERC1155TokenId,
  getERC1155Recipient,
} from '../shared/evmTransactionDisplay';

/** Extension host adapter: retain its metadata lookup and stale-result guards. */
export const getTransactionDisplayInfo = async (
  tx: any,
  currency: string,
  skipUnknownTokenFetch = false,
  controller?: any
): Promise<EvmTransactionDisplayInfo> => {
  const inner = getSmartAccountDisplayTransaction(tx);
  if (inner)
    return getTransactionDisplayInfo(
      inner,
      currency,
      skipUnknownTokenFetch,
      controller
    );
  if (
    tx?.historySource !==
      EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer &&
    !isTokenTransfer(tx)
  ) {
    return getEvmTransactionDisplayInfo(tx, currency);
  }
  const { accounts, activeAccount, accountAssets, activeNetwork } =
    store.getState().vault;
  const chainId = Number(tx.chainId ?? activeNetwork.chainId);
  const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
  const accountId = activeAccount.id;
  const accountType = activeAccount.type;
  const networkUrl = activeNetwork.url;
  return getEvmTransactionDisplayInfo(tx, currency, {
    chainId: activeNetwork.chainId,
    assets: accountAssets[activeAccount.type]?.[activeAccount.id]?.ethereum,
    ...(!skipUnknownTokenFetch && chainId === Number(activeNetwork.chainId)
      ? {
          lookupToken: async (tokenAddress: string) => {
            const details = controller?.wallet?.getTokenDetails
              ? await controller.wallet.getTokenDetails(
                  tokenAddress,
                  currentAccount?.address
                )
              : await controllerEmitter(
                  ['wallet', 'getTokenDetails'],
                  [tokenAddress, currentAccount?.address]
                );
            const latest = store.getState().vault;
            const sameContext =
              Number(latest.activeNetwork.chainId) === chainId &&
              latest.activeNetwork.url === networkUrl &&
              latest.activeAccount.id === accountId &&
              latest.activeAccount.type === accountType;
            return details && sameContext ? (details as ITokenDetails) : null;
          },
        }
      : {}),
  });
};

const ENTRYPOINT_HANDLE_OPS_SELECTOR = id(
  'handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)'
).slice(0, 10);
const ERC7579_EXECUTE_SELECTOR = id('execute(bytes32,bytes)').slice(0, 10);
const INSTALL_MODULE_SELECTOR = id(
  'installModule(uint256,address,bytes)'
).slice(0, 10);
const UNINSTALL_MODULE_SELECTOR = id(
  'uninstallModule(uint256,address,bytes)'
).slice(0, 10);
const ROTATE_VALIDATOR_SELECTOR = id(
  'rotateValidator(address,bytes,bytes)'
).slice(0, 10);

const decodeERC7579ExecutionCalldata = (
  mode: string,
  executionCalldata: string
): any[] | null => {
  const callType = mode.slice(0, 4).toLowerCase();
  if (callType === '0x00') {
    if (executionCalldata.length < 106) {
      return null;
    }
    const target = getAddress(`0x${executionCalldata.slice(2, 42)}`);
    const [value] = defaultAbiCoder.decode(
      ['uint256'],
      `0x${executionCalldata.slice(42, 106)}`
    );
    const data = `0x${executionCalldata.slice(106)}`;

    return [{ data, target, value }];
  }

  if (callType === '0x01') {
    const [executions] = defaultAbiCoder.decode(
      ['tuple(address target,uint256 value,bytes callData)[]'],
      executionCalldata
    ) as unknown as [any[]];

    return executions.map((execution) => ({
      data: execution.callData || execution.data || execution[2] || '0x',
      target: execution.target || execution[0],
      value: execution.value || execution[1] || '0',
    }));
  }

  return null;
};

/** Decode every inner ERC-7579 execution while preserving the outer history. */
export const getSmartAccountExecutionTransactions = (
  tx: any,
  {
    requireDefaultExecution = false,
    requireMatchingSmartAccount = false,
  }: {
    requireDefaultExecution?: boolean;
    requireMatchingSmartAccount?: boolean;
  } = {}
): any[] => {
  const input = String(tx?.input || tx?.data || '');
  if (!input || input === '0x' || input.length < 10) {
    return [];
  }

  try {
    let executions: any[] | null = null;
    let smartAccountExecutionFrom = tx.smartAccountExecutionFrom || tx.from;
    if (input.startsWith(ENTRYPOINT_HANDLE_OPS_SELECTOR)) {
      const [userOperations] = defaultAbiCoder.decode(
        [
          'tuple(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[]',
          'address',
        ],
        `0x${input.slice(10)}`
      ) as unknown as [any[], string];
      const smartAccount = String(
        tx.smartAccountExecutionFrom || ''
      ).toLowerCase();
      const matchingUserOperation = userOperations.find(
        (operation) =>
          smartAccount &&
          String(operation.sender || operation[0]).toLowerCase() ===
            smartAccount
      );
      const userOperation = matchingUserOperation || userOperations[0];
      if (requireMatchingSmartAccount && !matchingUserOperation) {
        return [];
      }
      const callData = String(
        userOperation?.callData || userOperation?.[3] || ''
      );
      if (!callData.startsWith(ERC7579_EXECUTE_SELECTOR)) {
        return [];
      }
      const [mode, executionCalldata] = defaultAbiCoder.decode(
        ['bytes32', 'bytes'],
        `0x${callData.slice(10)}`
      ) as unknown as [string, string];
      if (requireDefaultExecution && mode.slice(4, 6).toLowerCase() !== '00') {
        return [];
      }
      executions = decodeERC7579ExecutionCalldata(mode, executionCalldata);
      smartAccountExecutionFrom =
        tx.smartAccountExecutionFrom ||
        userOperation.sender ||
        userOperation[0] ||
        tx.from;
    } else {
      return [];
    }

    if (!executions?.length) {
      return [];
    }

    return executions.map((execution) => ({
      ...tx,
      from: smartAccountExecutionFrom,
      input: execution.data || '0x',
      data: execution.data || '0x',
      to: execution.target,
      value: execution.value?.toString?.() || String(execution.value || '0'),
    }));
  } catch (error) {
    return [];
  }
};

export const getSmartAccountDisplayTransaction = (tx: any): any | null => {
  const executions = getSmartAccountExecutionTransactions(tx);
  if (executions.length === 0) {
    return null;
  }

  try {
    const outerTo = String(tx?.to || '').toLowerCase();
    const smartAccount = String(executions[0]?.from || '').toLowerCase();
    const isMeaningfulExecution = (execution: any) => {
      const target = String(execution.to || '').toLowerCase();
      const data = String(execution.input || execution.data || '0x');
      const value = String(execution.value || '0');

      return (
        data !== '0x' ||
        value !== '0' ||
        (target !== outerTo && target !== smartAccount)
      );
    };
    const moduleInstallExecution = executions.find((execution) => {
      const data = String(
        execution.input || execution.data || '0x'
      ).toLowerCase();
      return (
        data.startsWith(INSTALL_MODULE_SELECTOR) ||
        data.startsWith(ROTATE_VALIDATOR_SELECTOR)
      );
    });
    const hasModuleUninstallExecution = executions.some((execution) => {
      const data = String(
        execution.input || execution.data || '0x'
      ).toLowerCase();
      return data.startsWith(UNINSTALL_MODULE_SELECTOR);
    });
    const selected =
      (hasModuleUninstallExecution && moduleInstallExecution) ||
      executions.find((execution) => isMeaningfulExecution(execution)) ||
      executions[executions.length - 1];

    return selected;
  } catch (error) {
    return null;
  }
};

export const getAssetBalance = (asset: any, isBitcoinBased: boolean) => {
  if (!isBitcoinBased) {
    const value = Number(asset.balance);

    return `${formatFullPrecisionBalance(value, 4)} ${asset.tokenSymbol}`;
  }

  const formattedBalance = truncate(
    asset.decimals === 0
      ? String(asset.balance ?? '0')
      : formatCurrency(String(asset.balance ?? '0'), asset.decimals),
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
  alert: any,
  t: (key: string, options?: { hash: string }) => string,
  fallbackNonce: number | undefined,
  signerAddress: string | undefined,
  walletScope: IWalletNavigationScope,
  approvedMaximumFee: string | undefined
) => {
  // Safety check: this function is only for EVM networks
  const { isBitcoinBased } = store.getState().vault;
  if (isBitcoinBased) {
    alert.error(t('transactions.cancelNotAvailableUtxo'));
    return;
  }

  try {
    const current = getWalletNavigationScope();
    if (
      !walletScope ||
      current.account !== walletScope.account ||
      current.network !== walletScope.network ||
      Number(store.getState().vault.activeNetwork?.chainId) !== chainId
    )
      throw new Error('Transaction context changed');
    const response = await controllerEmitter(
      ['wallet', 'cancelEvmTransaction'],
      [
        txHash,
        isLegacy,
        fallbackNonce,
        signerAddress,
        { chainId, walletScope },
        { approvedMaximumFee },
      ]
    );

    if (!response) {
      alert.error(t('transactions.transactionCancelFailed'));
      return;
    }

    const { isCanceled, error, transaction } = response as {
      error: boolean;
      isCanceled: boolean;
      transaction?: IEvmTransactionResponse;
    };

    if (!isCanceled && error) {
      alert.warning(t('transactions.transactionNotFoundOrConfirmed'));
      return;
    }

    switch (isCanceled) {
      case true:
        try {
          await controllerEmitter(
            ['wallet', 'setEvmTransactionCancelSubmitted'],
            [txHash, chainId, transaction]
          );
        } catch (metadataError) {
          if (
            error ||
            typeof transaction?.hash !== 'string' ||
            !/^0x[0-9a-f]{64}$/i.test(transaction.hash)
          )
            throw metadataError;
          console.error(
            'Replacement history could not be saved:',
            metadataError
          );
          alert.warning(
            t('transactions.replacementHistoryWarning', {
              hash: transaction.hash,
            })
          );
          return transaction.hash;
        }

        alert.success(t('transactions.transactionCancelSubmitted'));
        break;
      case false:
        alert.error(t('transactions.transactionCancelFailed'));
        break;
    }
  } catch (error) {
    console.error('Error cancelling transaction:', error);

    alert.error(t('transactions.transactionCancelFailed'));
  }
};

export const previewCancelTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  nonce: number | undefined,
  signerAddress: string | undefined,
  walletScope: IWalletNavigationScope
): Promise<string> => {
  const response = (await controllerEmitter(
    ['wallet', 'cancelEvmTransaction'],
    [
      txHash,
      isLegacy,
      nonce,
      signerAddress,
      { chainId, walletScope },
      { previewOnly: true },
    ]
  )) as
    | { error?: boolean; isCanceled?: boolean; maximumFee?: string }
    | undefined;
  const current = getWalletNavigationScope();
  const maximumFee = response?.maximumFee;
  if (
    current.account !== walletScope.account ||
    current.network !== walletScope.network ||
    response?.error === true ||
    response?.isCanceled !== false ||
    typeof maximumFee !== 'string' ||
    !/^(0|[1-9][0-9]{0,77})$/.test(maximumFee)
  )
    throw new Error('Cancellation fee unavailable');
  return maximumFee;
};

const requestSpeedUp = (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  signerAddress: string | undefined,
  options: EvmReplacementFeeApproval & { walletScope: IWalletNavigationScope }
) =>
  controllerEmitter(
    ['wallet', 'speedUpEvmTransaction'],
    [txHash, isLegacy, chainId, signerAddress, options]
  );

export const previewSpeedUpTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  signerAddress?: string,
  scope = getWalletNavigationScope()
): Promise<string> => {
  const { isBitcoinBased, activeNetwork } = store.getState().vault;
  if (isBitcoinBased || Number(activeNetwork?.chainId) !== chainId)
    throw new Error('Transaction network changed');
  const response = (await requestSpeedUp(
    txHash,
    isLegacy,
    chainId,
    signerAddress,
    { previewOnly: true, walletScope: scope }
  )) as
    | {
        code?: string;
        error?: boolean;
        isSpeedUp?: boolean;
        maximumFee?: string;
      }
    | undefined;
  const current = getWalletNavigationScope();
  const maximumFee = response?.maximumFee;
  if (
    current.account !== scope.account ||
    current.network !== scope.network ||
    store.getState().vault.isBitcoinBased
  )
    throw new Error('Transaction context changed');
  if (response?.code === 'REPLACEMENT_VALUE_WOULD_CHANGE')
    throw Object.assign(new Error('Replacement would change the amount'), {
      code: 'REPLACEMENT_VALUE_WOULD_CHANGE',
    });
  if (
    response?.error === true ||
    response?.isSpeedUp !== false ||
    typeof maximumFee !== 'string' ||
    maximumFee.length > 78 ||
    !/^(0|[1-9][0-9]*)$/.test(maximumFee)
  )
    throw new Error('Replacement fee unavailable');
  return maximumFee;
};

const speedUpTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  alert: any,
  t: (key: string, options?: { hash: string }) => string,
  signerAddress: string | undefined,
  approvedMaximumFee: string | undefined,
  walletScope: IWalletNavigationScope
) => {
  // Safety check: this function is only for EVM networks
  const { isBitcoinBased } = store.getState().vault;
  if (isBitcoinBased) {
    alert.error(t('transactions.speedUpNotAvailableUtxo'));
    return;
  }

  try {
    const current = getWalletNavigationScope();
    if (
      !walletScope ||
      current.account !== walletScope.account ||
      current.network !== walletScope.network ||
      Number(store.getState().vault.activeNetwork?.chainId) !== chainId
    )
      throw new Error('Transaction context changed');
    if (
      typeof approvedMaximumFee !== 'string' ||
      !/^(0|[1-9][0-9]{0,77})$/.test(approvedMaximumFee)
    )
      throw new Error('Replacement fee approval required');
    const response = await requestSpeedUp(
      txHash,
      isLegacy,
      chainId,
      signerAddress,
      { approvedMaximumFee, walletScope }
    ).catch((error) => {
      if (error?.code === 'REPLACEMENT_VALUE_WOULD_CHANGE') return error;
      throw error;
    });

    if (!response) {
      alert.error(t('transactions.transactionSpeedUpFailed'));
      return;
    }

    const { isSpeedUp, error, transaction, code } = response as {
      code?: string;
      error: boolean;
      isSpeedUp: boolean;
      transaction: IEvmTransactionResponse;
    };

    if (code === 'REPLACEMENT_VALUE_WOULD_CHANGE') {
      const latest = getWalletNavigationScope();
      if (
        walletScope &&
        (latest.account !== walletScope.account ||
          latest.network !== walletScope.network ||
          Number(store.getState().vault.activeNetwork?.chainId) !== chainId)
      )
        return;
      alert.error(t('transactions.speedUpAmountWouldChange'));
      return;
    }
    if (!isSpeedUp && error) {
      alert.warning(t('transactions.transactionNotFoundOrConfirmed'));
      return;
    }

    switch (isSpeedUp) {
      case true:
        try {
          await controllerEmitter(
            ['wallet', 'setEvmTransactionAsAccelerated'],
            [txHash, chainId, transaction]
          );
        } catch (metadataError) {
          if (
            error ||
            typeof transaction?.hash !== 'string' ||
            !/^0x[0-9a-f]{64}$/i.test(transaction.hash)
          )
            throw metadataError;
          console.error(
            'Replacement history could not be saved:',
            metadataError
          );
          alert.warning(
            t('transactions.replacementHistoryWarning', {
              hash: transaction.hash,
            })
          );
          return transaction.hash;
        }

        alert.success(t('transactions.transactionAcceleratedSuccessfully'));
        break;
      case false:
        alert.error(t('transactions.transactionSpeedUpFailed'));
        break;
    }
  } catch (error) {
    console.error('Error speeding up transaction:', error);

    alert.error(t('transactions.transactionSpeedUpFailed'));
  }
};

export const handleUpdateTransaction = async ({
  updateData,
  t,
}: {
  t: (key: string, options?: { hash: string }) => string;
  updateData: {
    alert: any;
    approvedMaximumFee: string;
    chainId: number;
    isLegacy: boolean;
    nonce?: number;
    signerAddress?: string;
    txHash: string;
    updateType: UpdateTxAction;
    walletScope: IWalletNavigationScope;
  };
}) => {
  const {
    alert,
    approvedMaximumFee,
    chainId,
    isLegacy,
    txHash,
    updateType,
    nonce,
    signerAddress,
    walletScope,
  } = updateData;

  switch (updateType) {
    case UpdateTxAction.Cancel:
      return await cancelTransaction(
        txHash,
        isLegacy,
        chainId,
        alert,
        t,
        nonce,
        signerAddress,
        walletScope,
        approvedMaximumFee
      );
    case UpdateTxAction.SpeedUp:
      return await speedUpTransaction(
        txHash,
        isLegacy,
        chainId,
        alert,
        t,
        signerAddress,
        approvedMaximumFee,
        walletScope
      );
  }
};
