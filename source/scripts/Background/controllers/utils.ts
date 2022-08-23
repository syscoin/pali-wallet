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
