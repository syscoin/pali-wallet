import InputDataDecoder from 'ethereum-input-data-decoder';

import erc20abi from './erc20.json';

export const getERC20DataDecoder = () => new InputDataDecoder(erc20abi as any);
