import { getAddress } from 'ethers/address';
import { createErc20Policy, encodeErc20Transfer } from '../../shared/erc20.ts';

const policy = createErc20Policy(getAddress);

/** One exact ERC20 execution for both wallet hosts. */
export function buildSmartAccountErc20Transfer(
  contractAddress: string,
  recipient: string,
  amountUnits: string
): Readonly<{ target: string; value: string; data: string }> {
  const target = policy.normalizeNonzeroHexAddress(contractAddress);
  const to = policy.normalizeNonzeroHexAddress(recipient);
  return Object.freeze({
    target,
    value: '0x0',
    data: encodeErc20Transfer(to, amountUnits),
  });
}
