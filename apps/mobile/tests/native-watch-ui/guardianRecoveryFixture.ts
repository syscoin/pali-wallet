import { getAddress } from 'ethers/address';
import { AbiCoder } from 'ethers/abi';
import { keccak256 } from 'ethers/crypto';
import { getNativeNetwork } from '../../src/custody/networkContext.ts';
import {
  getPaliModuleAddress,
  paliGuardianRecoveryModuleInterface as guardian,
  paliSmartAccountInterface as smartAccount,
} from '../../../../source/utils/smartAccount/contracts.ts';
import { getGuardianRecoveryOperationId } from '../../../../source/utils/smartAccount/guardianStatus.ts';

type Mode = 'healthy' | 'unsupported' | 'unsupported-revert' | 'unavailable' |
  'hold' | 'reorg' | 'eoa' | 'eoa-reorg' | 'empty-contract' | 'no-policy' | 'installed';
export const GUARDIAN_FIXTURE_ACCOUNT = getAddress(`0x${'11'.repeat(20)}`);
const MODULE = getAddress(getPaliModuleAddress(1, 'guardian-recovery'));
const RPC = getNativeNetwork('ethereum').rpcUrl;
const BLOCK_HASH = `0x${'22'.repeat(32)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;

export function createGuardianRecoveryFixture(account = GUARDIAN_FIXTURE_ACCOUNT, now = Date.now) {
  const activeSlot = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [account, 3]));
  const operation = getGuardianRecoveryOperationId({
    account, policyEpoch: '1', salt: word(1n), mode: word(0n), executionCalldata: '0x',
  });
  let mode: Mode = 'healthy';
  let code = '';
  const held = new Set<() => void>();
  const release = () => { for (const resume of held) resume(); held.clear(); };
  let methods: string[] = [];
  let interrupted = 0;
  let timestamp = 0;
  let guardianAddress = getAddress(`0x${'55'.repeat(20)}`), delay = 600, epoch = 1;
  return {
    configure(address: string, delaySeconds: number) { guardianAddress = getAddress(address); delay = delaySeconds; epoch++; },
    select(next: Mode, runtime: string) {
      release();
      mode = next;
      code = runtime;
      methods = [];
      interrupted = 0;
      timestamp = Math.floor(now() / 1000);
    },
    release,
    methods: () => methods.slice(),
    interrupted: () => interrupted,
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | undefined> {
      if (String(input) !== RPC || typeof init?.body !== 'string') return;
      const { method, id, params } = JSON.parse(init.body);
      if (method === 'eth_getBalance') return;
      if (init.credentials !== 'omit' || init.redirect !== 'error' || init.method !== 'POST' || !init.signal)
        throw new Error('Unowned fixture RPC');
      const signal = init.signal;
      const currentMode = mode;
      methods.push(method);
      if (currentMode === 'unavailable') return new Response(null, { status: 503 });
      if (currentMode === 'hold') {
        await new Promise<void>((resolve) => { held.add(resolve); });
        if (signal.aborted) interrupted++;
      }
      if (currentMode === 'unsupported-revert' && method === 'eth_call' && getAddress(params[0].to) === account) {
        return Response.json({ jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted' } });
      }
      const result = (() => {
        if (method === 'eth_chainId') return '0x1';
        if (method === 'eth_getBlockByNumber') {
          if (params[1] !== false) throw new Error('Unexpected block mode');
          return { number: '0x20', gasLimit: '0x1c9c380', baseFeePerGas: '0x1', timestamp: `0x${timestamp.toString(16)}`,
            hash: ['reorg', 'eoa-reorg'].includes(currentMode) && params[0] !== 'latest' ? `0x${'44'.repeat(32)}` : BLOCK_HASH };
        }
        if (params.at(-1) !== '0x20') throw new Error('Unanchored fixture request');
        if (method === 'eth_getCode') {
          const target = getAddress(params[0]);
          if (target === MODULE) return currentMode.startsWith('unsupported') ? '0x' : code;
          if (target === account && (currentMode === 'eoa' || currentMode === 'eoa-reorg')) return '0x';
          if (target === account && currentMode === 'empty-contract') return '0x6000';
        }
        if (method === 'eth_getStorageAt' && getAddress(params[0]) === MODULE)
          return currentMode.startsWith('unsupported') || currentMode === 'no-policy' || currentMode === 'installed' ? word(0n)
            : params[1] === activeSlot ? operation : word(BigInt(timestamp - 100));
        if (method === 'eth_call') {
          const { to, data } = params[0];
          if (getAddress(to) === account) {
            const call = smartAccount.parseTransaction({ data });
            if (call?.name !== 'isModuleInstalled' || call.args[0] !== 2n || getAddress(call.args[1]) !== MODULE)
              throw new Error('Unexpected module probe');
            if (['eoa', 'eoa-reorg', 'empty-contract'].includes(currentMode)) return '0x';
            return smartAccount.encodeFunctionResult('isModuleInstalled', [currentMode !== 'no-policy']);
          }
          if (getAddress(to) !== MODULE) throw new Error('Unexpected guardian target');
          const call = guardian.parseTransaction({ data });
          if (!call || getAddress(call.args[0]) !== account) throw new Error('Unexpected guardian account');
          if (currentMode.startsWith('unsupported')) return '0x';
          if (call.name === 'config') return guardian.encodeFunctionResult('config', [[delay, delay * 2, 1, currentMode !== 'no-policy']]);
          if (call.name === 'guardians') return guardian.encodeFunctionResult('guardians', [[guardianAddress]]);
          if (call.name === 'policyEpoch') return guardian.encodeFunctionResult('policyEpoch', [epoch]);
        }
        throw new Error('Unexpected guardian RPC');
      })();
      return Response.json({ jsonrpc: '2.0', id, result });
    },
  };
}
