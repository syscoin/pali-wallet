import {
  getBlacklistTargetsForEvmCall,
  shouldResolveEvmCallBlacklistContractType,
  type IEvmCallBlacklistTarget,
} from '../shared/evmCallBlacklist.ts';
import { getContractType } from 'utils/validations';

export const getBlacklistTargetsForEvmCallWithContractType = async ({
  controller,
  data,
  to,
  web3Provider,
}: {
  controller?: any;
  data?: string;
  to?: string;
  web3Provider?: any;
}): Promise<IEvmCallBlacklistTarget[]> => {
  let tokenStandard: string | undefined;

  if (to && web3Provider && shouldResolveEvmCallBlacklistContractType(data)) {
    try {
      tokenStandard = (await getContractType(to, web3Provider, controller))
        ?.type;
    } catch {
      tokenStandard = undefined;
    }
  }

  return getBlacklistTargetsForEvmCall({
    data,
    to,
    tokenStandard,
  });
};
