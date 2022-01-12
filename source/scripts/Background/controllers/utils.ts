export const countDecimals = (x: number) => {
  if (Math.floor(x) === x) return 0;
  return x.toString().split(".")[1].length || 0;
};

export const isNFT = (guid: number) => {
  const assetGuid = BigInt.asUintN(64, BigInt(guid));

  return assetGuid >> BigInt(32) > 0;
};

export const sortList = (list: any) =>
  list.sort((a: any, b: any) => {
    const previous: any = a.symbol.toLowerCase();
    const next: any = b.symbol.toLowerCase();

    //@ts-ignore
    return (previous > next) - (previous < next);
  });
