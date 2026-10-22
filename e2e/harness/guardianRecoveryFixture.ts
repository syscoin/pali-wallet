import { AbiCoder, keccak256 } from 'ethers';

import { paliGuardianRecoveryModuleInterface } from '../../source/utils/smartAccount/contracts';
import { PALI_INFRASTRUCTURE_BY_ID } from '../../source/utils/smartAccount/deployment';

import { createSmartAccountHydrationFixture } from './smartAccountHydrationFixture';
import { VISUAL_FIXTURE_RPC, type VisualRead } from './visualFixture';
import type { BrowserContext } from '@playwright/test';

const OPERATION = `0x${'61'.repeat(32)}`;
const runtime = `0x${PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule.deployCalldata!.slice(
  -5662 * 2
)}`;
const slot = (type: string, key: string, index: number) =>
  keccak256(AbiCoder.defaultAbiCoder().encode([type, 'uint256'], [key, index]));
const word = (value: bigint | number) =>
  `0x${BigInt(value).toString(16).padStart(64, '0')}`;

/** Real wallet with synthetic, runtime-attested chain reads; no local recovery intent. */
export function createGuardianRecoveryFixture() {
  if (
    keccak256(runtime) !==
    PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule.runtimeCodeHash
  )
    throw new Error(
      'Guardian fixture runtime does not match the pinned module'
    );
  const hydration = createSmartAccountHydrationFixture();
  const timestamp = Math.floor(Date.now() / 1000);
  const state = {
    blockNumber: 100,
    timestamp,
    activeOperation: OPERATION,
    scheduledAt: timestamp - 100,
    canceled: false,
    executed: false,
    failStorage: false,
  };
  const block = () => ({
    number: `0x${state.blockNumber.toString(16)}`,
    hash: word(state.blockNumber),
    timestamp: `0x${state.timestamp.toString(16)}`,
  });
  const activeSlot = slot('address', hydration.base.smartAccountAddress, 3);
  const scheduleSlot = slot('bytes32', OPERATION, 4);
  let storageGate: Promise<void> | undefined;
  let releaseStorage: (() => void) | undefined;
  let storageEntered: (() => void) | undefined;
  let storageStarted: Promise<void> | undefined;

  const read = async (
    requestUrl: string,
    method: string,
    payload?: unknown
  ): Promise<VisualRead | undefined> => {
    const url = new URL(requestUrl);
    if (
      url.origin !== VISUAL_FIXTURE_RPC ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      method !== 'POST'
    )
      return hydration.read(requestUrl, method, payload);
    const calls = Array.isArray(payload) ? payload : [payload];
    const reads: string[] = [];
    const unsupported: string[] = [];
    const responses = await Promise.all(
      calls.map(async (raw) => {
        const call = raw as
          | { id?: unknown; jsonrpc?: string; method?: string; params?: any[] }
          | undefined;
        let result: unknown;
        let handled = false;
        let failure = false;
        if (call?.jsonrpc === '2.0' && Array.isArray(call.params)) {
          if (
            call.method === 'eth_getBlockByNumber' &&
            call.params.length === 2 &&
            call.params[1] === false &&
            ['latest', block().number].includes(call.params[0])
          ) {
            handled = true;
            result = block();
          } else if (
            call.method === 'eth_getCode' &&
            call.params.length === 2 &&
            ['latest', block().number].includes(call.params[1]) &&
            String(call.params[0]).toLowerCase() ===
              hydration.guardianAddress.toLowerCase()
          ) {
            handled = true;
            result = runtime;
          } else if (
            call.method === 'eth_getStorageAt' &&
            call.params.length === 3 &&
            String(call.params[0]).toLowerCase() ===
              hydration.guardianAddress.toLowerCase() &&
            call.params[2] === block().number
          ) {
            handled = true;
            storageEntered?.();
            if (storageGate) await storageGate;
            failure = state.failStorage;
            if (call.params[1] === activeSlot) result = state.activeOperation;
            else if (call.params[1] === scheduleSlot)
              result = word(
                BigInt(state.scheduledAt) |
                  (BigInt(Number(state.executed)) << BigInt(48)) |
                  (BigInt(Number(state.canceled)) << BigInt(56))
              );
          } else if (
            call.method === 'eth_call' &&
            call.params.length === 2 &&
            ['latest', block().number].includes(call.params[1]) &&
            String(call.params[0]?.to).toLowerCase() ===
              hydration.guardianAddress.toLowerCase()
          ) {
            let parsed;
            try {
              parsed = paliGuardianRecoveryModuleInterface.parseTransaction({
                data: call.params[0].data,
              });
            } catch {
              /* Rejected below. */
            }
            if (
              parsed &&
              String(parsed.args[0]).toLowerCase() ===
                hydration.base.smartAccountAddress.toLowerCase()
            ) {
              const values: Record<string, unknown[]> = {
                config: [[600, 1200, 1, hydration.state.guardianInstalled]],
                guardians: [[hydration.base.address]],
                policyEpoch: [7],
              };
              if (values[parsed.name]) {
                handled = true;
                result =
                  paliGuardianRecoveryModuleInterface.encodeFunctionResult(
                    parsed.fragment,
                    values[parsed.name]
                  );
              }
            }
          }
        }
        if (!handled) {
          const fallback = await hydration.read(requestUrl, method, raw);
          if (!fallback) return undefined;
          reads.push(...fallback.reads);
          unsupported.push(...(fallback.unsupported || []));
          return fallback.body;
        }
        reads.push(`rpc:${call!.method}`);
        if (result === undefined) unsupported.push(call!.method!);
        return failure || result === undefined
          ? {
              jsonrpc: '2.0',
              id: call!.id,
              error: {
                code: -32000,
                message: 'Synthetic guardian status read unavailable',
              },
            }
          : { jsonrpc: '2.0', id: call!.id, result };
      })
    );
    if (responses.some((value) => value === undefined)) return undefined;
    return {
      body: Array.isArray(payload) ? responses : responses[0],
      reads,
      unsupported,
    };
  };

  return {
    ...hydration,
    state,
    hydrationState: hydration.state,
    operationId: OPERATION,
    runtime,
    read,
    holdStorage() {
      if (storageGate) throw new Error('Storage read is already held');
      storageStarted = new Promise<void>((resolve) => {
        storageEntered = resolve;
      });
      storageGate = new Promise<void>((resolve) => {
        releaseStorage = resolve;
      });
      return storageStarted;
    },
    releaseStorage() {
      releaseStorage?.();
      storageGate = undefined;
      releaseStorage = undefined;
      storageEntered = undefined;
    },
    async install(context: BrowserContext, localOrigin: string) {
      await hydration.install(context, localOrigin);
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== VISUAL_FIXTURE_RPC || request.method() !== 'POST')
          return route.fallback();
        let payload: unknown;
        try {
          payload = request.postDataJSON();
        } catch {
          return route.fallback();
        }
        const calls = Array.isArray(payload) ? payload : [payload];
        if (
          calls.some((call) =>
            /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
              call?.method || ''
            )
          )
        )
          return route.fallback();
        const result = await read(request.url(), request.method(), payload);
        if (!result) return route.fallback();
        hydration.audit.reads.push(...result.reads);
        hydration.audit.deniedUnknown.push(
          ...(result.unsupported || []).map((name) => `rpc:${name}`)
        );
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(result.body),
        });
      });
      return hydration.audit;
    },
  };
}
