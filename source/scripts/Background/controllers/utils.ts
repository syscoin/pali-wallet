import {
  validateCustomEthRpc,
  validateSysRpc as validateCustomSysRpc,
} from '@pollum-io/sysweb3-network';
import { getTokenByContract } from '@pollum-io/sysweb3-utils';

export const countDecimals = (x: number) => {
  if (Math.floor(x) === x) return 0;
  return x.toString().split('.')[1].length || 0;
};

export const isNFT = (guid: number) => {
  const assetGuid = BigInt.asUintN(64, BigInt(guid));

  return assetGuid >> BigInt(32) > 0;
};

export const sortList = (list: object[]) =>
  list.sort((a: any, b: any) => a.symbol.localeCompare(b.symbol));

export const base64 =
  /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

export const validateSysRpc = async (
  rpcUrl: string
): Promise<{ data: any; valid: boolean }> => {
  const { valid, data } = await validateCustomSysRpc(rpcUrl);

  return {
    valid,
    data,
  };
};

export const validateEthRpc = async (
  chainId: number,
  rpcUrl: string,
  tokenContractAddress?: string
): Promise<{ data: any; valid: boolean }> => {
  const { valid } = await validateCustomEthRpc(chainId, rpcUrl);

  let symbol = 'eth';
  if (tokenContractAddress) {
    const tokenData = await getTokenByContract(tokenContractAddress);
    symbol = tokenData.symbol;
  }

  const data = {
    chainId,
    url: rpcUrl,
    default: false,
    currency: symbol.toString().toLowerCase(),
  };

  return {
    valid,
    data,
  };
};
