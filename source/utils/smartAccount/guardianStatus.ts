import { defaultAbiCoder, getAddress, keccak256 } from 'utils/ethersV6Compat';

import {
  paliGuardianRecoveryModuleInterface,
  paliSmartAccountInterface,
} from './contracts';
import { PALI_INFRASTRUCTURE_BY_ID } from './deployment';

const ZERO = `0x${'00'.repeat(32)}`;
const MAX_BLOCK_AGE_MS = 420000;

export type GuardianRpcRequest = {
  method: string;
  params: unknown[];
};

export type GuardianOperationObservation = {
  executableAt: number;
  expiresAt: number;
  operationId: string;
  scheduledAt: number;
  status:
    | 'pending'
    | 'ready'
    | 'expired'
    | 'executed'
    | 'canceled'
    | 'inactive'
    | 'unknown';
};

export type GuardianRecoveryObservation = {
  account: string;
  active: GuardianOperationObservation | null;
  chainId: number;
  delay: string;
  delaySeconds: number;
  exists: boolean;
  expirationSeconds: number;
  guardianCount: string;
  guardians: string[];
  knownOperation: GuardianOperationObservation | null;
  moduleAddress: string;
  observedBlock: { hash: string; number: number; timestamp: number };
  pending: GuardianOperationObservation | null;
  policyEpoch: string;
  threshold: number;
};

function word(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
    throw new Error('Invalid guardian recovery storage word');
  return value.toLowerCase();
}

function quantity(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value))
    throw new Error('Invalid guardian recovery block');
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error('Invalid guardian recovery block');
  return result;
}

function storageSlot(type: string, key: string, index: number): string {
  return keccak256(defaultAbiCoder.encode([type, 'uint256'], [key, index]));
}

export function getGuardianRecoveryOperationId(operation: {
  account: string;
  executionCalldata: string;
  mode: string;
  policyEpoch: string;
  salt: string;
}): string {
  if (!/^[1-9][0-9]*$/.test(operation.policyEpoch))
    throw new Error('Invalid guardian recovery epoch');
  return keccak256(
    defaultAbiCoder.encode(
      ['address', 'uint256', 'bytes32', 'bytes32', 'bytes'],
      [
        getAddress(operation.account),
        operation.policyEpoch,
        operation.salt,
        operation.mode,
        operation.executionCalldata,
      ]
    )
  );
}

/** Read-only, bounded snapshot. No signing payload or local credential is recovered. */
export async function readGuardianRecoveryObservation({
  provider,
  account,
  moduleAddress,
  chainId,
  knownOperationId,
  assertCurrent = () => undefined,
  now = Date.now,
}: {
  account: string;
  assertCurrent?: () => void;
  chainId: number;
  knownOperationId?: string;
  moduleAddress: string;
  now?: () => number;
  provider: {
    batch?: (requests: GuardianRpcRequest[]) => Promise<unknown[]>;
    send: (method: string, params: unknown[]) => Promise<unknown>;
  };
}): Promise<GuardianRecoveryObservation> {
  account = getAddress(account);
  moduleAddress = getAddress(moduleAddress);
  if (knownOperationId) knownOperationId = word(knownOperationId);
  const batch = async (requests: GuardianRpcRequest[]) => {
    assertCurrent();
    // Production uses one validated JSON-RPC batch. The send-only path is for
    // explicit native/test providers, never a retry after a batch fails.
    if (provider.batch) {
      const results = await provider.batch(requests);
      assertCurrent();
      if (!Array.isArray(results) || results.length !== requests.length)
        throw new Error('Invalid guardian recovery batch response');
      return results;
    }
    const settled = await Promise.allSettled(
      requests.map(({ method, params }) => provider.send(method, params))
    );
    assertCurrent();
    const failed = settled.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return settled.map(
      (result) => (result as PromiseFulfilledResult<any>).value
    );
  };
  const assertChain = (value: unknown) => {
    if (quantity(value) !== chainId)
      throw new Error('Guardian recovery network changed');
  };
  const parseBlock = (value: any) => {
    if (!value) throw new Error('Guardian recovery block unavailable');
    return {
      number: quantity(value.number),
      timestamp: quantity(value.timestamp),
      hash: word(value.hash),
    };
  };
  const [chainBefore, latestBlock] = await batch([
    { method: 'eth_chainId', params: [] },
    { method: 'eth_getBlockByNumber', params: ['latest', false] },
  ]);
  assertChain(chainBefore);
  const block = parseBlock(latestBlock);
  const age = now() - block.timestamp * 1000;
  if (age < -30000 || age > MAX_BLOCK_AGE_MS)
    throw new Error('Guardian recovery chain data is stale');
  const tag = `0x${block.number.toString(16)}`;
  const call = (
    target: string,
    iface: any,
    fn: string,
    args: unknown[]
  ): GuardianRpcRequest => ({
    method: 'eth_call',
    params: [{ to: target, data: iface.encodeFunctionData(fn, args) }, tag],
  });
  const [
    code,
    installedData,
    configData,
    guardiansData,
    epochData,
    activeWord,
  ] = await batch([
    { method: 'eth_getCode', params: [moduleAddress, tag] },
    call(account, paliSmartAccountInterface, 'isModuleInstalled', [
      2,
      moduleAddress,
      '0x',
    ]),
    call(moduleAddress, paliGuardianRecoveryModuleInterface, 'config', [
      account,
    ]),
    call(moduleAddress, paliGuardianRecoveryModuleInterface, 'guardians', [
      account,
    ]),
    call(moduleAddress, paliGuardianRecoveryModuleInterface, 'policyEpoch', [
      account,
    ]),
    {
      method: 'eth_getStorageAt',
      params: [moduleAddress, storageSlot('address', account, 3), tag],
    },
  ]);
  // Do not interpret the ABI or private storage until this exact runtime is
  // attested, even though their network reads share one round trip.
  if (
    typeof code !== 'string' ||
    !/^0x(?:[0-9a-f]{2})+$/i.test(code) ||
    keccak256(code) !==
      PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule.runtimeCodeHash
  )
    throw new Error('Guardian recovery module runtime is unsupported');
  const decode = (iface: any, fn: string, data: unknown) => {
    if (typeof data !== 'string')
      throw new Error('Invalid guardian recovery response');
    return iface.decodeFunctionResult(fn, data);
  };
  const installed = decode(
    paliSmartAccountInterface,
    'isModuleInstalled',
    installedData
  );
  const configResult = decode(
    paliGuardianRecoveryModuleInterface,
    'config',
    configData
  );
  const guardiansResult = decode(
    paliGuardianRecoveryModuleInterface,
    'guardians',
    guardiansData
  );
  const epochResult = decode(
    paliGuardianRecoveryModuleInterface,
    'policyEpoch',
    epochData
  );
  const config = configResult[0];
  const exists = Boolean(installed[0] && config.installed);
  const delaySeconds = Number(config.delay);
  const expirationSeconds = Number(config.expiration);
  const threshold = Number(config.threshold);
  const policyEpoch = epochResult[0].toString();
  const guardians = Array.from(guardiansResult[0] as string[]).map(
    (value) => getAddress(value) as string
  );
  if (
    exists &&
    (!threshold ||
      threshold > guardians.length ||
      !expirationSeconds ||
      policyEpoch === '0')
  )
    throw new Error('Invalid guardian recovery policy');
  const activeId = word(activeWord);
  const ids = [
    ...new Set(
      [activeId, knownOperationId].filter((id): id is string =>
        Boolean(id && id !== ZERO)
      )
    ),
  ];
  const observations = new Map<string, GuardianOperationObservation>();
  const schedules = ids.length
    ? await batch(
        ids.map((operationId) => ({
          method: 'eth_getStorageAt',
          params: [moduleAddress, storageSlot('bytes32', operationId, 4), tag],
        }))
      )
    : [];
  for (const [index, operationId] of ids.entries()) {
    const raw = BigInt(word(schedules[index]));
    const scheduledAt = Number(raw & ((BigInt(1) << BigInt(48)) - BigInt(1)));
    const executed = (raw >> BigInt(48)) & BigInt(255);
    const canceled = (raw >> BigInt(56)) & BigInt(255);
    if (
      executed > BigInt(1) ||
      canceled > BigInt(1) ||
      (executed === BigInt(1) && canceled === BigInt(1)) ||
      scheduledAt > block.timestamp ||
      raw >> BigInt(64) !== BigInt(0) ||
      (operationId === activeId && !scheduledAt)
    )
      throw new Error('Unsupported guardian recovery storage layout');
    // A historical operation may belong to an earlier policy with a different
    // delay. Only the currently active policy gives us authoritative timing.
    const executableAt =
      scheduledAt && exists && operationId === activeId
        ? scheduledAt + delaySeconds
        : 0;
    const expiresAt = executableAt ? executableAt + expirationSeconds : 0;
    const status = !scheduledAt
      ? 'unknown'
      : executed
      ? 'executed'
      : canceled
      ? 'canceled'
      : !exists || operationId !== activeId
      ? 'inactive'
      : block.timestamp >= expiresAt
      ? 'expired'
      : block.timestamp >= executableAt
      ? 'ready'
      : 'pending';
    observations.set(operationId, {
      operationId,
      scheduledAt,
      executableAt,
      expiresAt,
      status,
    });
  }
  // This final batch must be dispatched AFTER every schedule read settles.
  // Combining it with the preceding batch could miss a reorg between items.
  const [anchoredBlock, chainAfter] = await batch([
    { method: 'eth_getBlockByNumber', params: [tag, false] },
    { method: 'eth_chainId', params: [] },
  ]);
  const after = parseBlock(anchoredBlock);
  if (
    after.number !== block.number ||
    after.hash !== block.hash ||
    after.timestamp !== block.timestamp
  )
    throw new Error('Guardian recovery block changed');
  assertChain(chainAfter);
  const completedAge = now() - block.timestamp * 1000;
  if (completedAge < -30000 || completedAge > MAX_BLOCK_AGE_MS)
    throw new Error('Guardian recovery chain data is stale');
  const active = observations.get(activeId) || null;
  return {
    account,
    chainId,
    moduleAddress,
    exists,
    delay: String(delaySeconds),
    delaySeconds,
    expirationSeconds,
    threshold,
    guardianCount: String(guardians.length),
    guardians,
    policyEpoch,
    observedBlock: block,
    active,
    pending:
      active && ['pending', 'ready'].includes(active.status) ? active : null,
    knownOperation: knownOperationId
      ? observations.get(knownOperationId) || null
      : null,
  };
}
