import { getAddress } from 'ethers/address';

import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';
import { EVM_SIGNED_RECORD_LIMITS } from '../shared/evmSignedRecordLimits.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from '../utils/smartAccount/contracts.ts';

import type { SmartAccountAuthorizationSummary } from './smartAccountAuthorization.ts';

export type SmartAccountRetirementRead = (
  method: string,
  params: readonly unknown[],
  signal: AbortSignal
) => Promise<unknown>;
const HASH = /^0x[\da-f]{64}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][\da-f]{0,63})$/i;
const fail = (): never => {
  throw Error('SMART_ACCOUNT_AUTHORIZATION_RETIREMENT_UNAVAILABLE');
};
const quantity = (value: unknown) =>
  typeof value === 'string' && QUANTITY.test(value) ? BigInt(value) : fail();
function block(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const row = value as Record<string, unknown>;
  if (typeof row.hash !== 'string' || !HASH.test(row.hash)) return fail();
  return { number: quantity(row.number), hash: row.hash.toLowerCase() };
}

/** Only finalized inner-nonce consumption can retire a disclosed authorization. */
export async function prepareSmartAccountAuthorizationRetirement(
  options: Readonly<{
    account: string;
    assertCurrent(): void;
    authorizations: readonly Pick<
      SmartAccountAuthorizationSummary,
      'account' | 'chainId' | 'operationHash' | 'operationNonce'
    >[];
    chainId: number;
    read: SmartAccountRetirementRead;
  }>
) {
  const account = getAddress(options.account);
  if (
    !Number.isSafeInteger(options.chainId) ||
    options.chainId <= 0 ||
    options.authorizations.length > EVM_SIGNED_RECORD_LIMITS.transactions
  )
    return fail();
  const rows = options.authorizations.filter(
    (row) => row.account === account && row.chainId === String(options.chainId)
  );
  const keys = [
    ...new Set(
      rows.map((row) => {
        if (
          !HASH.test(row.operationHash) ||
          !/^(0|[1-9]\d{0,77})$/.test(row.operationNonce) ||
          BigInt(row.operationNonce) >= BigInt(1) << BigInt(256)
        )
          return fail();
        return (BigInt(row.operationNonce) >> BigInt(64)).toString();
      })
    ),
  ];
  if (keys.length > 16) return fail();
  const entryPoint = getPaliEntryPointAddress(options.chainId);
  let anchor: ReturnType<typeof block> | undefined;
  let prior: ReadonlyMap<string, bigint> | undefined;
  const run = async () => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(Error('Retirement timed out')),
      10000
    );
    const check = () => {
      assertSynchronousEvmFeeGuard(options.assertCurrent);
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    const read = async (method: string, params: readonly unknown[]) => {
      check();
      let remove: () => void = () => undefined;
      try {
        const value = await Promise.race([
          options.read(method, params, controller.signal),
          new Promise<never>((_resolve, reject) => {
            const stop = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', stop, { once: true });
            remove = () => controller.signal.removeEventListener('abort', stop);
          }),
        ]);
        check();
        return value;
      } finally {
        remove();
      }
    };
    try {
      if (quantity(await read('eth_chainId', [])) !== BigInt(options.chainId))
        return fail();
      const finalized = block(
        await read('eth_getBlockByNumber', ['finalized', false])
      );
      const selected = anchor ?? finalized;
      if (selected.number > finalized.number) return fail();
      const tag = '0x' + selected.number.toString(16);
      const canonical = block(await read('eth_getBlockByNumber', [tag, false]));
      if (
        canonical.number !== selected.number ||
        canonical.hash !== selected.hash
      )
        return fail();
      const current = new Map(
        await Promise.all(
          keys.map(async (key) => {
            const raw = await read('eth_call', [
              {
                to: entryPoint,
                data: paliEntryPointInterface.encodeFunctionData('getNonce', [
                  account,
                  key,
                ]),
              },
              tag,
            ]);
            if (typeof raw !== 'string' || !HASH.test(raw)) return fail();
            const nonce = BigInt(raw);
            if (
              nonce >> BigInt(64) !== BigInt(key) ||
              (prior && prior.get(key) !== nonce)
            )
              return fail();
            return [key, nonce] as const;
          })
        )
      );
      const after = block(await read('eth_getBlockByNumber', [tag, false]));
      if (
        after.number !== selected.number ||
        after.hash !== selected.hash ||
        quantity(await read('eth_chainId', [])) !== BigInt(options.chainId)
      )
        return fail();
      check();
      anchor = selected;
      prior = current;
      return current;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
  if (!rows.length)
    return {
      hashes: Object.freeze([] as string[]),
      revalidate: async () => undefined,
    };
  const observed = await run();
  const hashes = Object.freeze(
    rows
      .filter(
        (row) =>
          BigInt(row.operationNonce) <
          observed.get((BigInt(row.operationNonce) >> BigInt(64)).toString())!
      )
      .map((row) => row.operationHash)
  );
  return {
    hashes,
    revalidate: async () => {
      await run();
    },
  };
}
