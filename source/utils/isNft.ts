export const isNFT = (guid: number): boolean => {
  const assetGuid = BigInt.asUintN(64, BigInt(guid));
  return assetGuid >> BigInt(32) > 0;
};
