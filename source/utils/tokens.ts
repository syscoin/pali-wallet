import axios from 'axios';
import { ethers } from 'ethers';
import lodash from 'lodash';

import { getErc20Abi, getErc21Abi } from '@pollum-io/sysweb3-utils';

import { Queue } from 'scripts/Background/controllers/transactions/queue';
import store from 'state/store';
import { ITokenEthProps } from 'types/tokens';
const config = {
  headers: {
    'X-User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
  },
  withCredentials: true,
};

export const getSymbolByChain = async (chain: string) => {
  const { data } = await axios.get(
    `https://api.coingecko.com/api/v3/coins/${chain}`,
    config
  );

  return data.symbol.toString().toUpperCase();
};
