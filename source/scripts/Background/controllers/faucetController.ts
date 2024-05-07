import axios from 'axios';

const claimFaucet = async (chainId: number, walletAddress: string) => {
  let chainName: string;

  if (chainId === 57) {
    chainName = `nevm-mainnet`;
  } else if (chainId === 5700) {
    chainName = `nevm-testnet`;
  } else if (chainId === 57000) {
    chainName = `rollux-testnet`;
  } else if (chainId === 570) {
    chainName = `rollux-mainnet`;
  } else {
    chainName = ``;
  }
  try {
    const { data } = await axios.get(
      `https://chains.tools/api/faucet/claim?networkKey=${chainName}&walletAddress=${walletAddress}`
    );

    return data;
  } catch (err) {
    return err;
  }
};

export { claimFaucet };
