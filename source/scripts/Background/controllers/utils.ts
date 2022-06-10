import {
  validateCustomEthRpc,
  validateSysRpc as validateCustomSysRpc,
} from '@pollum-io/sysweb3-network';

import ControllerUtils from './ControllerUtils';

const utils = ControllerUtils();

export const countDecimals = (x: number) => {
  if (Math.floor(x) === x) return 0;
  return x.toString().split('.')[1].length || 0;
};

export const isNFT = (guid: number) => {
  const assetGuid = BigInt.asUintN(64, BigInt(guid));

  return assetGuid >> BigInt(32) > 0;
};

export const sortList = (list: any) =>
  list.sort((a: any, b: any) => {
    const previous: any = a.symbol.toLowerCase();
    const next: any = b.symbol.toLowerCase();

    // @ts-ignore
    return (previous > next) - (previous < next);
  });

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

const getTokenData = async (address?: string) => {
  if (!address) return null;

  const tokenData: any = await utils.getTokenDataByContractAddress(
    address,
    'ethereum'
  );

  return tokenData;
};

export const validateEthRpc = async (
  chainId: number,
  rpcUrl: string,
  tokenContractAddress?: string
): Promise<{ data: any; valid: boolean }> => {
  const { valid } = await validateCustomEthRpc(chainId, rpcUrl);

  const tokenData = await getTokenData(tokenContractAddress);
  const symbol = tokenData && tokenData.symbol ? tokenData.symbol : 'eth';
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
