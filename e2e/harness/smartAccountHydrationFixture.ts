import {
  paliCompositeValidatorInterface,
  paliEcdsaValidatorInterface,
  paliGuardianRecoveryModuleInterface,
  paliP256WebAuthnValidatorInterface,
  paliSlhDsaValidatorInterface,
  paliSmartAccountInterface,
} from '../../source/utils/smartAccount/contracts';

import {
  createVisualFixture,
  visualFixtureRead,
  VISUAL_FIXTURE_RPC,
  type VisualRead,
} from './visualFixture';
import type { BrowserContext } from '@playwright/test';

const lower = (value: string) => value.toLowerCase();
const zero32 = `0x${'00'.repeat(32)}`;
const writeMethod =
  /^(?:eth_send|eth_sign|personal_|wallet_|sys_sign|sendrawtransaction|anvil_|evm_)/i;

/** Synthetic chain reads only; never substitutes wallet/controller/signing code. */
export function createSmartAccountHydrationFixture() {
  const base = createVisualFixture();
  const state = { deployed: false, guardianInstalled: false };
  const audit = {
    reads: [] as string[],
    deniedWrites: [] as string[],
    deniedUnknown: [] as string[],
  };
  const addressFor = (id: string) => {
    const address = base.infrastructure.find(
      (contract) => contract.id === id
    )?.address;
    if (!address) throw new Error(`Missing canonical fixture contract: ${id}`);
    return address;
  };
  const guardianAddress = addressFor('guardianRecoveryModule');
  const ecdsaAddress = base.validator.address;
  const interfaces = new Map([
    [lower(base.smartAccountAddress), paliSmartAccountInterface],
    [lower(ecdsaAddress), paliEcdsaValidatorInterface],
    [
      lower(addressFor('p256WebAuthnValidator')),
      paliP256WebAuthnValidatorInterface,
    ],
    [lower(addressFor('compositeValidator')), paliCompositeValidatorInterface],
    [lower(addressFor('slhDsaValidator')), paliSlhDsaValidatorInterface],
    [lower(guardianAddress), paliGuardianRecoveryModuleInterface],
  ]);
  let armed = false;
  let metadataReadCount = 0;
  const pending = new Map<number, () => void>();
  const entered = new Map<number, Array<() => void>>();
  const barrier = async () => {
    if (!armed) return;
    const number = ++metadataReadCount;
    const gate = new Promise<void>((resolve) => pending.set(number, resolve));
    entered.get(number)?.forEach((resolve) => resolve());
    entered.delete(number);
    await gate;
  };

  const contractRead = (to: string, data: string): string | undefined => {
    const iface = interfaces.get(lower(to));
    if (!iface) return undefined;
    let parsed;
    try {
      parsed = iface.parseTransaction({ data });
    } catch {
      return undefined;
    }
    if (!parsed) return undefined;
    const accountArg = () =>
      typeof parsed.args[0] === 'string' &&
      lower(parsed.args[0]) === lower(base.smartAccountAddress);
    let result: unknown[] | undefined;
    if (lower(to) === lower(base.smartAccountAddress)) {
      if (parsed.signature === 'activeValidator()') result = [ecdsaAddress];
      if (parsed.signature === 'isModuleInstalled(uint256,address,bytes)') {
        const kind = Number(parsed.args[0]);
        const address = lower(parsed.args[1]);
        if (parsed.args[2] !== '0x') return undefined;
        result = [
          (kind === 1 && address === lower(ecdsaAddress)) ||
            (kind === 2 &&
              address === lower(guardianAddress) &&
              state.guardianInstalled),
        ];
      }
    } else if (accountArg()) {
      if (lower(to) === lower(ecdsaAddress)) {
        if (parsed.signature === 'owners(address)') result = [[base.address]];
        if (parsed.signature === 'threshold(address)') result = [1];
      } else if (lower(to) === lower(guardianAddress)) {
        if (parsed.signature === 'config(address)')
          result = [[600, 1200, 1, state.guardianInstalled]];
        if (parsed.signature === 'guardians(address)')
          result = [[base.address]];
      } else if (
        lower(to) === lower(addressFor('p256WebAuthnValidator')) &&
        parsed.signature === 'authData(address)'
      ) {
        result = [[zero32, zero32, zero32, zero32, 0]];
      } else if (
        lower(to) === lower(addressFor('slhDsaValidator')) &&
        parsed.signature === 'authData(address)'
      ) {
        result = [[zero32, zero32]];
      } else if (lower(to) === lower(addressFor('compositeValidator'))) {
        if (parsed.signature === 'childValidators(address)') result = [[]];
        if (parsed.signature === 'threshold(address)') result = [0];
      }
    }
    return result === undefined
      ? undefined
      : iface.encodeFunctionResult(parsed.fragment, result);
  };

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
      url.username ||
      url.password ||
      url.hash ||
      method !== 'POST'
    ) {
      return visualFixtureRead(base, requestUrl, method, payload);
    }
    const calls = Array.isArray(payload) ? payload : [payload];
    if (!calls.length)
      return visualFixtureRead(base, requestUrl, method, payload);
    const reads: string[] = [],
      unsupported: string[] = [];
    const replies = await Promise.all(
      calls.map(async (raw) => {
        const call = raw as
          | {
              id?: unknown;
              jsonrpc?: string;
              method?: string;
              params?: unknown[];
            }
          | undefined;
        const fallback = () => {
          const result = visualFixtureRead(base, requestUrl, method, raw)!;
          reads.push(...result.reads);
          unsupported.push(...(result.unsupported || []));
          return result.body;
        };
        if (
          !call ||
          call.jsonrpc !== '2.0' ||
          typeof call.method !== 'string' ||
          !Array.isArray(call.params) ||
          writeMethod.test(call.method)
        )
          return fallback();
        let result: unknown;
        let handled = false;
        if (
          state.deployed &&
          call.method === 'eth_getCode' &&
          typeof call.params[0] === 'string' &&
          lower(call.params[0]) === lower(base.smartAccountAddress)
        ) {
          await barrier();
          handled = true;
          result = '0x60006000f3';
        } else if (
          state.deployed &&
          call.method === 'eth_getBalance' &&
          typeof call.params[0] === 'string' &&
          lower(call.params[0]) === lower(base.smartAccountAddress)
        ) {
          handled = true;
          result = '0xde0b6b3a7640000';
        } else if (state.deployed && call.method === 'eth_call') {
          const tx = call.params[0] as
            | { data?: unknown; to?: unknown }
            | undefined;
          if (tx && typeof tx.to === 'string' && interfaces.has(lower(tx.to))) {
            handled = true;
            if (call.params.length <= 2 && typeof tx.data === 'string')
              result = contractRead(tx.to, tx.data);
          }
        }
        if (!handled) return fallback();
        if (result === undefined) {
          unsupported.push(call.method);
          return {
            jsonrpc: '2.0',
            id: call.id,
            error: {
              code: -32601,
              message: 'Unsupported smart-account fixture read',
            },
          };
        }
        reads.push(`rpc:${call.method}`);
        return { jsonrpc: '2.0', id: call.id, result };
      })
    );
    return {
      body: Array.isArray(payload) ? replies : replies[0],
      reads,
      unsupported,
    };
  };

  return {
    base,
    state,
    audit,
    guardianAddress,
    read,
    get metadataReadCount() {
      return metadataReadCount;
    },
    armBarrier() {
      if (pending.size)
        throw new Error('Cannot rearm with pending metadata reads');
      metadataReadCount = 0;
      armed = true;
    },
    waitForRead(number: number) {
      if (!Number.isSafeInteger(number) || number < 1)
        throw new Error('Invalid metadata read number');
      if (metadataReadCount >= number) return Promise.resolve();
      return new Promise<void>((resolve) =>
        entered.set(number, [...(entered.get(number) || []), resolve])
      );
    },
    releaseRead(number: number) {
      const release = pending.get(number);
      if (!release) throw new Error(`Metadata read ${number} is not pending`);
      pending.delete(number);
      release();
    },
    releaseAll() {
      armed = false;
      for (const release of pending.values()) release();
      pending.clear();
    },
    async install(context: BrowserContext, localOrigin: string) {
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['http:', 'https:'].includes(url.protocol))
          return route.continue();
        if (
          url.origin === localOrigin &&
          url.pathname === '/' &&
          request.method() === 'GET'
        )
          return route.continue();
        let payload: unknown;
        try {
          payload = request.postDataJSON();
        } catch {
          /* Ordinary GET. */
        }
        const calls = Array.isArray(payload) ? payload : [payload];
        const writes = calls.filter((call) =>
          writeMethod.test((call as { method?: string })?.method || '')
        );
        if (writes.length || /\/sendtx(?:\/|$)/i.test(url.pathname)) {
          audit.deniedWrites.push(
            ...(writes.length
              ? writes.map((call) => (call as { method: string }).method)
              : [url.pathname])
          );
          return route.abort('blockedbyclient');
        }
        const result = await read(request.url(), request.method(), payload);
        if (!result) {
          audit.deniedUnknown.push(
            `${request.method()} ${url.origin}${url.pathname}`
          );
          return route.abort('blockedbyclient');
        }
        audit.reads.push(...result.reads);
        audit.deniedUnknown.push(
          ...(result.unsupported || []).map((name) => `rpc:${name}`)
        );
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(result.body),
        });
      });
      return audit;
    },
  };
}
