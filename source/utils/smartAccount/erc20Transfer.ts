import { getAddress } from 'ethers/address';

import {
  createErc20Policy,
  encodeErc20Transfer,
  parseErc20Units,
  parseErc20Decimals,
} from '../../shared/erc20.ts';

const policy = createErc20Policy(getAddress);

/** One exact ERC20 execution for both wallet hosts. */
export function buildSmartAccountErc20Transfer(
  contractAddress: string,
  recipient: string,
  amountUnits: string
): Readonly<{ data: string; target: string; value: string }> {
  const target = policy.normalizeNonzeroHexAddress(contractAddress);
  const to = policy.normalizeNonzeroHexAddress(recipient);
  return Object.freeze({
    target,
    value: '0x0',
    data: encodeErc20Transfer(to, amountUnits),
  });
}

export type SmartAccountExpectedErc20Transfer = Readonly<{
  amountUnits: string;
  contractAddress: string;
  decimals: number;
  recipient: string;
}>;

export function snapshotSmartAccountExpectedErc20Transfers(
  transfers: readonly SmartAccountExpectedErc20Transfer[] | undefined
): readonly SmartAccountExpectedErc20Transfer[] | undefined {
  if (transfers === undefined) return undefined;
  if (!Array.isArray(transfers) || transfers.length > 50)
    throw new Error('Invalid expected ERC20 transfers');
  return Object.freeze(
    transfers.map((transfer) =>
      Object.freeze({
        contractAddress: getAddress(transfer.contractAddress),
        recipient: getAddress(transfer.recipient),
        amountUnits: parseErc20Units(transfer.amountUnits),
        decimals: parseErc20Decimals(transfer.decimals),
      })
    )
  );
}
