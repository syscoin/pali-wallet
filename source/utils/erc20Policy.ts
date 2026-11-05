import { getAddress } from 'ethers/address';

import { createErc20Policy } from '../shared/erc20';

const policy = createErc20Policy(getAddress);

/** Syntax only, matching ethers isAddress; this does not validate a contract. */
export function isEvmAddress(value: unknown): boolean {
  try {
    policy.normalizeAddress(value);
    return true;
  } catch {
    return false;
  }
}
