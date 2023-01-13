export const isNFT = (guid: number): boolean => {
  console.log('GUID RECEIVED', guid);

  const assetGuid = BigInt.asUintN(64, BigInt(guid));
  return assetGuid >> BigInt(32) > 0;
};
