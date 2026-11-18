import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { withEvmReadPhase } from '../../shared/evmReadPhase.ts';
import { getAddress } from '../ethersV6Compat.ts';
import { assertJsonWorkBudget } from '../requestPayloadBudget.ts';

import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from './contracts.ts';
import { decodeSmartAccountUserOperationEvent } from './userOperationEvent.ts';
import type { SmartAccountAuthorizationSummary } from '../../wallet/smartAccountAuthorization.ts';

const hashPattern = /^0x[\da-f]{64}$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][\da-f]*)$/;
const decimalPattern = /^(?:0|[1-9]\d{0,77})$/;
const maximum = (BigInt(1) << BigInt(256)) - BigInt(1);
const windowBlocks = BigInt(2048);
const invalid = (): never => {
  throw Error('SMART_ACCOUNT_AUTHORIZATION_STATUS_UNAVAILABLE');
};
const hex = (value: bigint) => '0x' + value.toString(16);
function quantity(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 66 ||
    !quantityPattern.test(value)
  )
    return invalid();
  return BigInt(value);
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, any>;
}
function block(value: unknown) {
  const data = object(value),
    number = quantity(data.number);
  if (typeof data.hash !== 'string' || !hashPattern.test(data.hash))
    return invalid();
  return Object.freeze({
    number: number.toString(),
    hash: data.hash.toLowerCase(),
  });
}
type Anchor = ReturnType<typeof block>;
type Base = Readonly<{
  anchor: Anchor;
  currentNonce: string;
  operationHash: string;
}>;
export type SmartAccountAuthorizationObservation = Base &
  (
    | Readonly<{ kind: 'pending' | 'nonce-consumed' }>
    | Readonly<{
        block: Anchor;
        kind: 'observed';
        success: boolean;
        transactionHash: string;
      }>
  );

/** Public observation only. Nonce consumption alone never proves payment or cancellation.
 * Callers load the summary from authenticated storage and retain it across reorgs.
 * The bounded event window may miss an older outcome; it then stays explicitly unknown.
 */
export async function observeSmartAccountAuthorization(
  summary: SmartAccountAuthorizationSummary,
  provider: Parameters<typeof withEvmReadPhase>[0],
  assertCurrent: () => void,
  expectedChainId: number
): Promise<SmartAccountAuthorizationObservation> {
  assertSynchronousEvmFeeGuard(assertCurrent);
  const account = getAddress(summary.account),
    operationHash = summary.operationHash;
  if (
    typeof summary.chainId !== 'string' ||
    !decimalPattern.test(summary.chainId) ||
    !Number.isSafeInteger(expectedChainId) ||
    expectedChainId !== Number(summary.chainId) ||
    expectedChainId <= 0 ||
    !hashPattern.test(operationHash) ||
    !decimalPattern.test(summary.operationNonce) ||
    BigInt(summary.operationNonce) > maximum ||
    !decimalPattern.test(summary.observedAt.number) ||
    BigInt(summary.observedAt.number) > maximum ||
    !hashPattern.test(summary.observedAt.hash)
  )
    return invalid();
  const nonce = BigInt(summary.operationNonce),
    key = nonce >> BigInt(64);
  const entryPoint = getPaliEntryPointAddress(Number(summary.chainId));
  const event = paliEntryPointInterface.getEvent('UserOperationEvent')!;
  const topics = [
    event.topicHash,
    operationHash.toLowerCase(),
    '0x' + account.slice(2).toLowerCase().padStart(64, '0'),
  ];
  return withEvmReadPhase(provider, assertCurrent, async (phase) => {
    const anchor = block(
      await phase.sendFresh('eth_getBlockByNumber', ['latest', false])
    );
    const head = BigInt(anchor.number),
      origin = BigInt(summary.observedAt.number);
    const floor =
      head >= windowBlocks ? head - windowBlocks + BigInt(1) : BigInt(0);
    const from = origin <= head && origin > floor ? origin : floor;
    const [rawNonce, rawLogs] = await Promise.all([
      phase.send('eth_call', [
        {
          to: entryPoint,
          data: paliEntryPointInterface.encodeFunctionData('getNonce', [
            account,
            key,
          ]),
        },
        hex(head),
      ]),
      phase.send('eth_getLogs', [
        {
          address: entryPoint,
          fromBlock: hex(from),
          toBlock: hex(head),
          topics,
        },
      ]),
    ]);
    if (typeof rawNonce !== 'string' || !hashPattern.test(rawNonce))
      return invalid();
    const current = BigInt(rawNonce);
    if (current >> BigInt(64) !== key) return invalid();
    assertJsonWorkBudget(rawLogs, 16 * 1024, 8, 256);
    if (!Array.isArray(rawLogs) || rawLogs.length > 1) return invalid();
    const base = {
      operationHash: operationHash.toLowerCase(),
      anchor,
      currentNonce: current.toString(),
    };
    let observation: SmartAccountAuthorizationObservation;
    if (!rawLogs.length) {
      observation = Object.freeze({
        ...base,
        kind: current > nonce ? 'nonce-consumed' : 'pending',
      });
    } else {
      const log = object(rawLogs[0]);
      if (
        getAddress(log.address) !== getAddress(entryPoint) ||
        log.removed !== false ||
        !hashPattern.test(log.transactionHash) ||
        !hashPattern.test(log.blockHash) ||
        quantity(log.logIndex) > maximum ||
        quantity(log.blockNumber) < from ||
        quantity(log.blockNumber) > head ||
        !Array.isArray(log.topics) ||
        log.topics[3]?.toLowerCase() !== '0x' + '0'.repeat(64)
      )
        return invalid();
      const decoded = decodeSmartAccountUserOperationEvent({
        topics: log.topics,
        data: log.data,
      });
      if (
        decoded.operationHash !== operationHash.toLowerCase() ||
        decoded.sender !== account ||
        decoded.nonce !== nonce.toString() ||
        current <= nonce
      )
        return invalid();
      const receipt = object(
        await phase.send('eth_getTransactionReceipt', [log.transactionHash])
      );
      if (
        receipt.status !== '0x1' ||
        receipt.transactionHash?.toLowerCase() !==
          log.transactionHash.toLowerCase() ||
        receipt.blockHash?.toLowerCase() !== log.blockHash.toLowerCase() ||
        receipt.blockNumber !== log.blockNumber ||
        !Array.isArray(receipt.logs)
      )
        return invalid();
      assertJsonWorkBudget(receipt.logs, 1024 * 1024, 16, 100_000);
      const matches = receipt.logs.filter((candidate: unknown) => {
        const row = object(candidate);
        return (
          row.address?.toLowerCase() === entryPoint.toLowerCase() &&
          row.data === log.data &&
          row.transactionHash?.toLowerCase() ===
            log.transactionHash.toLowerCase() &&
          row.blockHash?.toLowerCase() === log.blockHash.toLowerCase() &&
          row.blockNumber === log.blockNumber &&
          row.logIndex === log.logIndex &&
          row.removed === false &&
          Array.isArray(row.topics) &&
          JSON.stringify(
            row.topics.map((value: unknown) =>
              typeof value === 'string' ? value.toLowerCase() : value
            )
          ) ===
            JSON.stringify(
              log.topics.map((value: string) => value.toLowerCase())
            )
        );
      });
      if (matches.length !== 1) return invalid();
      const canonical = block(
        await phase.send('eth_getBlockByNumber', [log.blockNumber, false])
      );
      if (
        canonical.number !== quantity(log.blockNumber).toString() ||
        canonical.hash !== log.blockHash.toLowerCase()
      )
        return invalid();
      observation = Object.freeze({
        ...base,
        kind: 'observed',
        transactionHash: log.transactionHash.toLowerCase(),
        block: canonical,
        success: decoded.success,
      });
    }
    const unchanged = block(
      await phase.sendFresh('eth_getBlockByNumber', [hex(head), false])
    );
    if (unchanged.number !== anchor.number || unchanged.hash !== anchor.hash)
      return invalid();
    assertSynchronousEvmFeeGuard(assertCurrent);
    return observation;
  });
}
