import { getAddress } from 'ethers/address';

import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from '../utils/smartAccount/contracts.ts';
import { getSmartAccountUserOpHash } from '../utils/smartAccount/userOperationHash.ts';

import {
  readEvmRpcHash,
  readEvmRpcQuantity,
} from './evmTransactionObservation.ts';
import type { SmartAccountPackedUserOperation } from '../utils/smartAccount/account.ts';

export type SmartAccountCallsIdentity = Readonly<{
  chainId: number;
  entryPoint: string;
  sender: string;
  userOpHash: string;
}>;

/** Normalize ethers and raw JSON-RPC receipts through the existing exact validators. */
export function normalizeDappCallsReceipt(value: any, expectedHash: string) {
  if (value === null) return null;
  const quantity = (input: unknown) => {
    if (typeof input === 'number') {
      if (!Number.isSafeInteger(input) || input < 0)
        throw new Error('Invalid calls receipt quantity');
      input = BigInt(input);
    }
    if (typeof input === 'bigint') input = `0x${input.toString(16)}`;
    if (
      input &&
      typeof input === 'object' &&
      'toHexString' in input &&
      typeof input.toHexString === 'function'
    ) {
      const hex: unknown = input.toHexString();
      if (typeof hex !== 'string' || !/^0x[\da-f]{1,64}$/i.test(hex))
        throw new Error('Invalid calls receipt quantity');
      input = `0x${BigInt(hex).toString(16)}`;
    }
    return readEvmRpcQuantity(input);
  };
  const hash = readEvmRpcHash(value?.hash ?? value?.transactionHash);
  if (hash !== readEvmRpcHash(expectedHash))
    throw new Error('Calls receipt hash changed');
  const status = quantity(value.status);
  if (status !== BigInt(0) && status !== BigInt(1))
    throw new Error('Invalid calls receipt status');
  if (!Array.isArray(value.logs)) throw new Error('Invalid calls receipt logs');
  const logs = value.logs.map((log: any) => {
    if (
      !Array.isArray(log?.topics) ||
      typeof log.data !== 'string' ||
      !/^0x(?:[\da-f]{2})*$/i.test(log.data)
    )
      throw new Error('Invalid calls receipt log');
    return {
      address: getAddress(log.address),
      data: log.data,
      topics: log.topics.map(readEvmRpcHash),
    };
  });
  return {
    hash,
    status: Number(status),
    blockHash: readEvmRpcHash(value.blockHash),
    blockNumber: `0x${quantity(value.blockNumber).toString(16)}`,
    gasUsed: `0x${quantity(value.gasUsed).toString(16)}`,
    logs,
  };
}

/** Capture the operation prepared and authorized by the wallet. */
export function captureSmartAccountCallsIdentity(
  operation: SmartAccountPackedUserOperation,
  chainId: number
): SmartAccountCallsIdentity {
  const identity = {
    chainId,
    entryPoint: getPaliEntryPointAddress(chainId).toLowerCase(),
    sender: operation.sender.toLowerCase(),
    userOpHash: getSmartAccountUserOpHash(operation, chainId).toLowerCase(),
  };
  assertSmartAccountCallsIdentity(identity, chainId);
  return Object.freeze(identity);
}

export function assertSmartAccountCallsIdentity(
  identity: SmartAccountCallsIdentity,
  chainId: number
): void {
  if (
    !identity ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    identity.chainId !== chainId ||
    !/^0x[0-9a-f]{40}$/.test(identity.sender) ||
    !/^0x[0-9a-f]{64}$/.test(identity.userOpHash) ||
    identity.entryPoint !== getPaliEntryPointAddress(chainId).toLowerCase()
  )
    throw new Error('Invalid smart account calls identity');
}

/** Missing, ambiguous or malformed operation evidence remains inconclusive. */
export function getSmartAccountCallsOutcome(
  identity: SmartAccountCallsIdentity | undefined,
  chainId: number,
  receipts: readonly any[]
): boolean | undefined {
  if (!identity) return;
  try {
    assertSmartAccountCallsIdentity(identity, chainId);
  } catch {
    return;
  }
  // One failed outer transaction reverted every inner effect and log.
  if (receipts.length === 1 && receipts[0]?.status === 0) return false;
  const eventTopic =
    paliEntryPointInterface.getEvent('UserOperationEvent')!.topicHash;
  let outcome: boolean | undefined;
  let matches = 0;
  for (const receipt of receipts) {
    if (!Array.isArray(receipt?.logs)) continue;
    for (const log of receipt.logs) {
      if (
        !log ||
        typeof log !== 'object' ||
        typeof log.address !== 'string' ||
        log.address.toLowerCase() !== identity.entryPoint ||
        typeof log.topics?.[0] !== 'string' ||
        log.topics[0].toLowerCase() !== eventTopic ||
        typeof log.topics?.[1] !== 'string' ||
        log.topics[1].toLowerCase() !== identity.userOpHash
      )
        continue;
      try {
        const parsed = paliEntryPointInterface.parseLog(log);
        if (
          !parsed ||
          parsed.args.sender.toLowerCase() !== identity.sender ||
          receipt.status !== 1 ||
          ++matches !== 1
        )
          return;
        outcome = parsed.args.success;
      } catch {
        return;
      }
    }
  }
  return outcome;
}
