import InputDataDecoder from 'ethereum-input-data-decoder';

import { getErc20Abi } from '@pollum-io/sysweb3-utils';

export const erc20DataDecoder = () => new InputDataDecoder(getErc20Abi());
