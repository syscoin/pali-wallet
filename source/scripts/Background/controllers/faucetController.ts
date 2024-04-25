import axios from 'axios';

const claimFaucet = async (chainId: number, walletAddress: string) => {
  let wallet: string;

  if (chainId === 57) {
    wallet = `nevm-mainnet`;
  } else if (chainId === 5700) {
    wallet = `nevm-testnet`;
  } else if (chainId === 57000) {
    wallet = `rollux-testnet`;
  } else if (chainId === 570) {
    wallet = `rollux-mainnet`;
  } else {
    wallet = ``;
  }

  const { data } = await axios.get(
    `https://chains.tools/api/faucet/claim?networkKey=${wallet}&walletAddress=${walletAddress}`
  );

  console.log(data);
  return data;
};

export { claimFaucet };
//nevm-testnet nevm-mainnet rollux-testnet rollux-mainnet
