import {
  CustomJsonRpcProvider,
  IKeyringAccountState,
} from '@sidhujag/sysweb3-keyring';

import { readEvmRpcQuantity } from '../../../../shared/evmTransactionObservation';
import { ensureEvmDisplayIdentity } from '../providers/evmDisplayIdentity';
import { formatEther } from 'utils/ethersV6Compat';

import { IEvmBalanceController } from './types';
import type { AssetReadOwner } from '../assets/types';

const EvmBalanceController = (
  web3Provider: CustomJsonRpcProvider
): IEvmBalanceController => {
  const getEvmBalanceForAccount = async (
    currentAccount: IKeyringAccountState,
    owner?: AssetReadOwner
  ) => {
    const provider = web3Provider;
    if (!provider) {
      console.error(
        '[EvmBalanceController] Missing provider in getEvmBalanceForAccount'
      );
      return '0';
    }

    const signal = owner?.signal ?? provider.signal;
    owner?.assertCurrent();
    const { chainId } = await provider.getNetwork();
    await ensureEvmDisplayIdentity(
      provider,
      chainId,
      signal,
      owner?.identityContext
    );
    owner?.assertCurrent();
    const [observation] = await provider.readMany(
      [
        {
          method: 'eth_getBalance',
          params: [currentAccount.address, 'latest'],
        },
      ],
      { signal }
    );
    if (observation?.status === 'rejected') throw observation.reason;
    if (observation?.status !== 'fulfilled')
      throw new Error('Native balance unavailable');
    const getBalance = readEvmRpcQuantity(observation.value);
    await ensureEvmDisplayIdentity(
      provider,
      chainId,
      signal,
      owner?.identityContext
    );
    owner?.assertCurrent();

    // Always return the full precision balance as a string
    // Formatting for display should happen in the UI components
    const fullPrecisionBalance = formatEther(getBalance);

    return fullPrecisionBalance;
  };

  return {
    getEvmBalanceForAccount,
  };
};

export default EvmBalanceController;
