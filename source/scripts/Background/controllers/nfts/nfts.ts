import { detectCollectibles } from '@pollum-io/sysweb3-utils';

const NftsController = () => {
  const getUserNfts = async (
    userAddress: string,
    chainId: number,
    rpcUrl: string
  ) => {
    const userNfts = await detectCollectibles(userAddress, chainId, rpcUrl);

    return userNfts;
  };

  return {
    getUserNfts,
  };
};

export default NftsController;
