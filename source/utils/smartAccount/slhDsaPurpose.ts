import { getAddress, hexDataSlice } from '../ethersV6Compat.ts';

import {
  ERC7579_MODULE_TYPE_VALIDATOR,
  getPaliModuleAddress,
  paliSmartAccountInterface,
} from './contracts.ts';
import type { ISmartAccountMetadata } from '../../types/network.ts';

type SmartAccountExecutionIntent = {
  data?: string;
  target: string;
  value: string;
};

const SMART_ACCOUNT_ROTATE_VALIDATOR_SELECTOR =
  paliSmartAccountInterface.getFunction('rotateValidator')!.selector;
const SMART_ACCOUNT_INSTALL_MODULE_SELECTOR =
  paliSmartAccountInterface.getFunction('installModule')!.selector;
const SMART_ACCOUNT_UNINSTALL_MODULE_SELECTOR =
  paliSmartAccountInterface.getFunction('uninstallModule')!.selector;

const isSmartAccountRotateValidatorExecution = ({
  accountAddress,
  execution,
  smartAccount,
}: {
  accountAddress?: string;
  execution: SmartAccountExecutionIntent;
  smartAccount: ISmartAccountMetadata;
}) => {
  try {
    if (
      !accountAddress ||
      getAddress(execution.target) !== getAddress(accountAddress) ||
      hexDataSlice(execution.data || '0x', 0, 4).toLowerCase() !==
        SMART_ACCOUNT_ROTATE_VALIDATOR_SELECTOR
    ) {
      return false;
    }

    const activeValidatorAddress = smartAccount.auth?.validator;
    const activeValidatorData = smartAccount.auth?.data || '0x';
    if (!activeValidatorAddress) {
      return false;
    }

    const [nextValidatorAddress, , nextValidatorData] =
      paliSmartAccountInterface.decodeFunctionData(
        'rotateValidator',
        execution.data || '0x'
      );

    return (
      getAddress(nextValidatorAddress) !== getAddress(activeValidatorAddress) ||
      String(nextValidatorData).toLowerCase() !==
        String(activeValidatorData).toLowerCase()
    );
  } catch {
    return false;
  }
};

const getValidatorInstallFromExecution = ({
  accountAddress,
  execution,
  smartAccount,
}: {
  accountAddress?: string;
  execution: SmartAccountExecutionIntent;
  smartAccount: ISmartAccountMetadata;
}) => {
  try {
    if (
      !accountAddress ||
      getAddress(execution.target) !== getAddress(accountAddress) ||
      hexDataSlice(execution.data || '0x', 0, 4).toLowerCase() !==
        SMART_ACCOUNT_INSTALL_MODULE_SELECTOR
    ) {
      return null;
    }

    const [moduleTypeId, moduleAddress, initData] =
      paliSmartAccountInterface.decodeFunctionData(
        'installModule',
        execution.data || '0x'
      );
    if (Number(moduleTypeId) !== ERC7579_MODULE_TYPE_VALIDATOR) {
      return null;
    }

    const activeValidatorAddress = smartAccount.auth?.validator;
    const activeValidatorData = smartAccount.auth?.data || '0x';
    if (
      activeValidatorAddress &&
      getAddress(moduleAddress) === getAddress(activeValidatorAddress) &&
      String(initData).toLowerCase() ===
        String(activeValidatorData).toLowerCase()
    ) {
      return null;
    }

    return {
      initData: String(initData),
      moduleAddress: getAddress(moduleAddress),
    };
  } catch {
    return null;
  }
};

const isActiveValidatorUninstallExecution = ({
  accountAddress,
  execution,
  smartAccount,
}: {
  accountAddress?: string;
  execution: SmartAccountExecutionIntent;
  smartAccount: ISmartAccountMetadata;
}) => {
  try {
    const activeValidatorAddress = smartAccount.auth?.validator;
    if (
      !accountAddress ||
      !activeValidatorAddress ||
      getAddress(execution.target) !== getAddress(accountAddress) ||
      hexDataSlice(execution.data || '0x', 0, 4).toLowerCase() !==
        SMART_ACCOUNT_UNINSTALL_MODULE_SELECTOR
    ) {
      return false;
    }

    const [moduleTypeId, moduleAddress] =
      paliSmartAccountInterface.decodeFunctionData(
        'uninstallModule',
        execution.data || '0x'
      );
    return (
      Number(moduleTypeId) === ERC7579_MODULE_TYPE_VALIDATOR &&
      getAddress(moduleAddress) === getAddress(activeValidatorAddress)
    );
  } catch {
    return false;
  }
};

const isSmartAccountInstallUninstallValidatorSwitch = ({
  accountAddress,
  executions,
  smartAccount,
}: {
  accountAddress?: string;
  executions: SmartAccountExecutionIntent[];
  smartAccount: ISmartAccountMetadata;
}) =>
  executions.some((execution) =>
    getValidatorInstallFromExecution({
      accountAddress,
      execution,
      smartAccount,
    })
  ) &&
  executions.some((execution) =>
    isActiveValidatorUninstallExecution({
      accountAddress,
      execution,
      smartAccount,
    })
  );

export const canUseReservedSLHDSASignature = ({
  accountAddress,
  executions,
  smartAccount,
}: {
  accountAddress?: string;
  executions: SmartAccountExecutionIntent[];
  smartAccount: ISmartAccountMetadata;
}) => {
  const kind = smartAccount.auth?.module || smartAccount.auth?.scheme;
  const isSwitch =
    executions.some((execution) =>
      isSmartAccountRotateValidatorExecution({
        accountAddress,
        execution,
        smartAccount,
      })
    ) ||
    isSmartAccountInstallUninstallValidatorSwitch({
      accountAddress,
      executions,
      smartAccount,
    });
  if (kind === 'slh-dsa') return isSwitch;
  if (kind !== 'composite' || !isSwitch) return false;

  // A composite may contain a nearly exhausted PQ key. Its reserve is only
  // available for a concrete escape to a canonical non-PQ builtin, not for
  // ordinary activity or editing a composite that may retain the same key.
  try {
    const escapeValidators = ['ecdsa', 'p256-webauthn'].map((id) =>
      getAddress(
        getPaliModuleAddress(
          smartAccount.chainId,
          id as 'ecdsa' | 'p256-webauthn'
        )
      )
    );
    if (executions.length === 1) {
      const execution = executions[0]!;
      if (
        isSmartAccountRotateValidatorExecution({
          accountAddress,
          execution,
          smartAccount,
        })
      ) {
        const [nextValidator] = paliSmartAccountInterface.decodeFunctionData(
          'rotateValidator',
          execution.data || '0x'
        );
        return escapeValidators.includes(getAddress(nextValidator));
      }
      return false;
    }
    // The normal alternative switch installs the replacement, then removes
    // the old active composite. Do not grant reserve use to arbitrary batches
    // that can reactivate it later in the same operation.
    if (executions.length !== 2) return false;
    const install = getValidatorInstallFromExecution({
      accountAddress,
      execution: executions[0]!,
      smartAccount,
    });
    return Boolean(
      install &&
        escapeValidators.includes(install.moduleAddress) &&
        isActiveValidatorUninstallExecution({
          accountAddress,
          execution: executions[1]!,
          smartAccount,
        })
    );
  } catch {
    return false;
  }
};
