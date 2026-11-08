import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from '../utils/smartAccount/contracts.ts';
import { getSmartAccountUserOpHash } from '../utils/smartAccount/userOperationHash.ts';

import type { SmartAccountPackedUserOperation } from '../utils/smartAccount/account.ts';

export type SmartAccountCallsIdentity = Readonly<{
  chainId: number;
  entryPoint: string;
  sender: string;
  userOpHash: string;
}>;

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
