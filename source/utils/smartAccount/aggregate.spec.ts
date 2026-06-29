jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/address');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/keccak256');
jest.unmock('@ethersproject/strings');

import { Interface } from '@ethersproject/abi';
import { hexZeroPad } from '@ethersproject/bytes';
import { keccak256 } from '@ethersproject/keccak256';

import {
  aggregateContractCalls,
  clearMulticall3AddressCache,
  resolveMulticall3Address,
} from './aggregate';
import {
  PALI_CANONICAL_ENTRYPOINT_ADDRESS,
  PALI_INFRASTRUCTURE_BY_ID,
  PALI_INFRASTRUCTURE_CONTRACTS,
  PALI_MODULE_CANONICAL_ADDRESSES,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
  PALI_ZKSYS_ENTRYPOINT_ADDRESS,
  getPaliCanonicalEntryPointAddress,
  getPaliCanonicalFactoryAddress,
  getPaliInfrastructureById,
  getPaliInfrastructureContracts,
} from './deployment';

const TEST_INTERFACE = new Interface([
  'function getValue() view returns (uint256)',
  'function getFlag() view returns (bool)',
]);

const MULTICALL3_INTERFACE = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)',
]);

const TARGET_A = '0x1111111111111111111111111111111111111111';
const TARGET_B = '0x2222222222222222222222222222222222222222';

const calls = [
  { args: [], fn: 'getValue', iface: TEST_INTERFACE, target: TARGET_A },
  { args: [], fn: 'getFlag', iface: TEST_INTERFACE, target: TARGET_B },
];

const encodeValue = (value: number) =>
  TEST_INTERFACE.encodeFunctionResult('getValue', [value]);
const encodeFlag = (flag: boolean) =>
  TEST_INTERFACE.encodeFunctionResult('getFlag', [flag]);

describe('smart account RPC aggregation', () => {
  beforeEach(() => {
    clearMulticall3AddressCache();
  });

  it('uses a single Multicall3 aggregate3 eth_call when deployed', async () => {
    const aggregateResponse = MULTICALL3_INTERFACE.encodeFunctionResult(
      'aggregate3',
      [
        [
          { returnData: encodeValue(42), success: true },
          { returnData: encodeFlag(true), success: true },
        ],
      ]
    );
    const provider = {
      call: jest.fn().mockResolvedValue(aggregateResponse),
      getCode: jest.fn().mockResolvedValue('0x60806040'),
      sendBatch: jest.fn(),
    };

    const results = await aggregateContractCalls(provider as any, 1, calls);

    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(provider.call).toHaveBeenCalledWith(
      expect.objectContaining({ to: PALI_MULTICALL3_CANONICAL_ADDRESS })
    );
    expect(provider.sendBatch).not.toHaveBeenCalled();
    expect(results[0].success).toBe(true);
    expect(Number(results[0].success && results[0].result[0])).toBe(42);
    expect(results[1].success).toBe(true);
    expect(results[1].success && results[1].result[0]).toBe(true);
  });

  it('maps Multicall3 per-call failures and empty returns to success=false', async () => {
    const aggregateResponse = MULTICALL3_INTERFACE.encodeFunctionResult(
      'aggregate3',
      [
        [
          { returnData: '0x', success: false },
          // Succeeded call against an address without code: empty returndata.
          { returnData: '0x', success: true },
        ],
      ]
    );
    const provider = {
      call: jest.fn().mockResolvedValue(aggregateResponse),
      getCode: jest.fn().mockResolvedValue('0x60806040'),
      sendBatch: jest.fn(),
    };

    const results = await aggregateContractCalls(provider as any, 2, calls);

    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(false);
  });

  it('falls back to JSON-RPC batching when Multicall3 is unavailable', async () => {
    const provider = {
      call: jest.fn(),
      getCode: jest.fn().mockResolvedValue('0x'),
      sendBatch: jest
        .fn()
        .mockResolvedValue([encodeValue(7), encodeFlag(false)]),
    };

    const results = await aggregateContractCalls(provider as any, 3, calls);

    expect(provider.sendBatch).toHaveBeenCalledTimes(1);
    expect(provider.sendBatch).toHaveBeenCalledWith('eth_call', [
      [
        {
          data: TEST_INTERFACE.encodeFunctionData('getValue', []),
          to: TARGET_A,
        },
        'latest',
      ],
      [
        {
          data: TEST_INTERFACE.encodeFunctionData('getFlag', []),
          to: TARGET_B,
        },
        'latest',
      ],
    ]);
    expect(provider.call).not.toHaveBeenCalled();
    expect(Number(results[0].success && results[0].result[0])).toBe(7);
    expect(results[1].success && results[1].result[0]).toBe(false);
  });

  it('falls back to sequential eth_calls with per-call failure isolation', async () => {
    const provider = {
      call: jest
        .fn()
        .mockRejectedValueOnce(new Error('execution reverted'))
        .mockResolvedValueOnce(encodeFlag(true)),
      getCode: jest.fn().mockResolvedValue('0x'),
      sendBatch: jest.fn().mockRejectedValue(new Error('batch not allowed')),
    };

    const results = await aggregateContractCalls(provider as any, 4, calls);

    expect(provider.call).toHaveBeenCalledTimes(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(true);
  });

  it('caches positive Multicall3 resolution per chain', async () => {
    const provider = {
      call: jest.fn(),
      getCode: jest.fn().mockResolvedValue('0x60806040'),
      sendBatch: jest.fn(),
    };

    const first = await resolveMulticall3Address(provider as any, 5);
    const second = await resolveMulticall3Address(provider as any, 5);

    expect(first).toBe(PALI_MULTICALL3_CANONICAL_ADDRESS);
    expect(second).toBe(PALI_MULTICALL3_CANONICAL_ADDRESS);
    expect(provider.getCode).toHaveBeenCalledTimes(1);

    clearMulticall3AddressCache(5);
    await resolveMulticall3Address(provider as any, 5);
    expect(provider.getCode).toHaveBeenCalledTimes(2);
  });

  it('shares a single in-flight probe across concurrent cold-cache callers', async () => {
    let releaseProbe!: (code: string) => void;
    const probeGate = new Promise<string>((resolve) => {
      releaseProbe = resolve;
    });
    const provider = {
      call: jest.fn(),
      getCode: jest.fn().mockReturnValue(probeGate),
      sendBatch: jest.fn(),
    };

    const first = resolveMulticall3Address(provider as any, 7);
    const second = resolveMulticall3Address(provider as any, 7);
    releaseProbe('0x60806040');

    const [firstAddress, secondAddress] = await Promise.all([first, second]);
    expect(firstAddress).toBe(PALI_MULTICALL3_CANONICAL_ADDRESS);
    expect(secondAddress).toBe(PALI_MULTICALL3_CANONICAL_ADDRESS);
    expect(provider.getCode).toHaveBeenCalledTimes(1);
  });

  it('does not let a probe detached by cache invalidation write stale results', async () => {
    let releaseStaleProbe!: (code: string) => void;
    const staleGate = new Promise<string>((resolve) => {
      releaseStaleProbe = resolve;
    });
    // Stale probe: started before deployment, sees no code anywhere.
    const staleProvider = {
      call: jest.fn(),
      getCode: jest.fn().mockReturnValue(staleGate),
      sendBatch: jest.fn(),
    };
    const stalePromise = resolveMulticall3Address(staleProvider as any, 8);

    // Infrastructure deployment invalidates the chain mid-probe.
    clearMulticall3AddressCache(8);

    // Fresh probe after deployment finds the contract.
    const freshProvider = {
      call: jest.fn(),
      getCode: jest.fn().mockResolvedValue('0x60806040'),
      sendBatch: jest.fn(),
    };
    const freshAddress = await resolveMulticall3Address(
      freshProvider as any,
      8
    );
    expect(freshAddress).toBe(PALI_MULTICALL3_CANONICAL_ADDRESS);

    // The detached stale probe resolves negative, but must not clobber the
    // fresh positive cache entry.
    releaseStaleProbe('0x');
    await stalePromise;
    const cachedAddress = await resolveMulticall3Address(
      {
        call: jest.fn(),
        getCode: jest.fn().mockResolvedValue('0x'),
        sendBatch: jest.fn(),
      } as any,
      8
    );
    expect(cachedAddress).toBe(PALI_MULTICALL3_CANONICAL_ADDRESS);
  });

  it('resolves the Pali CREATE2 deployment when the canonical address is empty', async () => {
    const infraAddress = PALI_INFRASTRUCTURE_BY_ID.multicall3.address;
    const provider = {
      call: jest.fn(),
      getCode: jest.fn(async (address: string) => {
        if (address.toLowerCase() === infraAddress.toLowerCase()) {
          return '0x60806040';
        }
        return '0x';
      }),
      sendBatch: jest.fn(),
    };

    const resolved = await resolveMulticall3Address(provider as any, 6);
    expect(resolved).toBe(infraAddress);
  });

  it('registers the official Multicall3 creation bytecode as optional infrastructure', () => {
    const entry = PALI_INFRASTRUCTURE_CONTRACTS.find(
      (contract) => contract.id === 'multicall3'
    );
    expect(entry).toBeDefined();
    expect(entry?.optional).toBe(true);
    const deployCalldata = entry?.deployCalldata;
    if (!deployCalldata) {
      throw new Error('Multicall3 deploy calldata is required');
    }
    // CREATE2 deploy payload is salt ++ initCode through the canonical
    // deterministic-deployment proxy.
    expect(deployCalldata.startsWith(entry?.salt as string)).toBe(true);
    const initCode = `0x${deployCalldata.slice(
      2 + (entry?.salt.length as number) - 2
    )}`;
    // Pins the embedded bytecode to the official pre-signed Multicall3
    // deployment transaction (deployer 0x05f32B3c..., nonce 0).
    expect(keccak256(initCode)).toBe(
      '0x0b2046aa018109118d518235014ac2c679dcbdff32c64705fdf50d048cd32d22'
    );
    expect(entry?.bytecodeHash).toBe(keccak256(initCode));
  });

  it('uses the standard EntryPoint profile by default and Syscoin profile only on zkSYS', () => {
    const standard = getPaliInfrastructureById(1);
    const zksys = getPaliInfrastructureById(57057);

    expect(getPaliCanonicalEntryPointAddress(1)).toBe(
      PALI_CANONICAL_ENTRYPOINT_ADDRESS
    );
    expect(getPaliCanonicalEntryPointAddress(57057)).toBe(
      PALI_ZKSYS_ENTRYPOINT_ADDRESS
    );
    expect(standard.entryPoint.deployCalldata).toBeDefined();
    expect(zksys.entryPoint.deployCalldata).toBeUndefined();
    expect(zksys.entryPoint.externallyDeployed).toBe(true);
    expect(standard.entryPoint.address).not.toBe(zksys.entryPoint.address);
    expect(standard.accountImplementation.address).not.toBe(
      zksys.accountImplementation.address
    );
    expect(getPaliCanonicalFactoryAddress(1)).not.toBe(
      getPaliCanonicalFactoryAddress(57057)
    );
    expect(standard.ecdsaValidator.address).toBe(zksys.ecdsaValidator.address);
    expect(getPaliInfrastructureContracts(1)).toBe(
      PALI_INFRASTRUCTURE_CONTRACTS
    );
    expect(getPaliInfrastructureContracts(57057)).not.toBe(
      PALI_INFRASTRUCTURE_CONTRACTS
    );
  });

  it('wires the SLH-DSA validator to the deterministic verifier', () => {
    const verifier = PALI_INFRASTRUCTURE_BY_ID.slhDsaVerifier;
    const validator = PALI_INFRASTRUCTURE_BY_ID.slhDsaValidator;
    const deployCalldata = validator.deployCalldata;
    if (!deployCalldata) {
      throw new Error('SLH-DSA validator deploy calldata is required');
    }
    const initCode = `0x${deployCalldata.slice(2 + validator.salt.length - 2)}`;
    const verifierCodeHash =
      '31e33d9848db6a8821cf39adeb347aff047a308f52b04aee2a398e29fee8b628';

    expect(
      initCode.endsWith(
        `${hexZeroPad(verifier.address, 32).slice(2)}${verifierCodeHash}`
      )
    ).toBe(true);
    expect(validator.moduleId).toBe('slh-dsa');
    expect(PALI_MODULE_CANONICAL_ADDRESSES['slh-dsa']).toBe(validator.address);
  });
});
