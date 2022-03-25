import axios from 'axios';

// This will be called only by the gateway
export const checkForSyscoinJSLibNetwork = async ({ blockbookURL }) => {
  const response = await axios.get(`${blockbookURL}/api/v2`);
  const { coin } = response.data.blockbook;

  if (response && coin) {
    if (coin === 'Syscoin' || coin === 'Syscoin Testnet') {
      return true;
    }

    return false;
  }
};
