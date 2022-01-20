import store from 'state/store';
import axios from 'axios';

export const checkForSyscoinNetwork = async ({ blockbookURL }) => {
  const response = await axios.get(`${blockbookURL}/api/v2`);
  const { coin } = response.data.blockbook;

  if (response && coin) {
    if (coin === 'Syscoin' || coin === 'Syscoin Testnet') {
      return true;
    }

    return false;
  }
};

export const fetchState = async () => {
  const { blockbookURL } = store.getState().wallet;

  const isSyscoinNetwork = await checkForSyscoinNetwork({ blockbookURL });

  if (isSyscoinNetwork) {
    return 'sys';
  }

  return 'other';
};
