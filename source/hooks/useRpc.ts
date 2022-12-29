import useSWR from 'swr';

import {
  getBip44Chain,
  jsonRpcRequest,
  validateSysRpc,
} from '@pollum-io/sysweb3-network';

// move to sysweb3
const getUtxoRpc = async (url: string) => {
  const { valid, coin, chain } = await validateSysRpc(url);

  if (!valid) throw new Error('Invalid RPC');

  const { chainId } = getBip44Chain(coin, chain === 'test');

  return chainId;
};

const validateRpc = async (url: string, isUtxo?: boolean) => {
  if (isUtxo) return await getUtxoRpc(url);

  return await jsonRpcRequest(url, 'eth_chainId');
};

export const useRpcChainId = ({ isUtxo, rpcUrl }) => {
  const { data: chainId, ...response } = useSWR(
    () => rpcUrl ?? null,
    () => validateRpc(rpcUrl, isUtxo)
  );

  console.log({ isUtxo, rpcUrl, chainId });

  return {
    chainId: parseInt(chainId, 16),
    ...response,
  };
};
