import { chains } from 'eth-chains';
import useSWR from 'swr';

import {
  getBip44Chain,
  jsonRpcRequest,
  validateSysRpc,
} from '@pollum-io/sysweb3-network';
import { getSearch } from '@pollum-io/sysweb3-utils';

// move to sysweb3
const getUtxoRpc = async (url: string) => {
  const { valid, coin, chain } = await validateSysRpc(url);

  if (!valid) throw new Error('Invalid RPC');

  const { chainId } = getBip44Chain(coin, chain === 'test');

  return chainId;
};

export const validateRpc = async (url: string, isUtxo?: boolean) => {
  if (isUtxo) return await getUtxoRpc(url);

  return await jsonRpcRequest(url, 'eth_chainId');
};
