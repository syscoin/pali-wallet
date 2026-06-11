jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/address');
jest.unmock('@ethersproject/bignumber');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/keccak256');
jest.unmock('@ethersproject/strings');

import { Interface } from '@ethersproject/abi';

import type { SmartAccountValidatorModule } from 'types/network';

import {
  assertValidatorActivationAllowed,
  isPaliSignableValidator,
  listCompositeChildCandidates,
  preflightCustomValidatorInstall,
  SmartAccountLockoutError,
} from './custom';

const ECDSA_ADDR = '0x1111111111111111111111111111111111111111';
const CUSTOM_ADDR = '0x2222222222222222222222222222222222222222';
const COMPOSITE_ADDR = '0x3333333333333333333333333333333333333333';
const OWNER = '0x4444444444444444444444444444444444444444';

const PROBE_INTERFACE = new Interface([
  'function isModuleType(uint256 moduleTypeId) view returns (bool)',
]);

const ecdsaModule: SmartAccountValidatorModule = {
  address: ECDSA_ADDR,
  config: { owners: [OWNER], threshold: 1 },
  id: 'ecdsa',
  type: 'validator',
};

const customModule: SmartAccountValidatorModule = {
  address: CUSTOM_ADDR,
  config: { moduleType: 1, name: 'PQ validator' },
  id: 'custom',
  type: 'validator',
};

const compositeOf = (
  children: string[],
  threshold = 1
): SmartAccountValidatorModule => ({
  address: COMPOSITE_ADDR,
  config: { childValidators: children, threshold },
  id: 'composite',
  type: 'validator',
});

const metadataWith = (modules: SmartAccountValidatorModule[]) => ({
  installedModules: modules,
});

// Provider stub: no Multicall3 deployed (getCode '0x' for probe), direct
// eth_call fallback returns the configured isModuleType answer.
const providerFor = ({
  hasCode,
  isValidator,
}: {
  hasCode: boolean;
  isValidator: boolean;
}) => ({
  call: jest.fn(async () =>
    PROBE_INTERFACE.encodeFunctionResult('isModuleType', [isValidator])
  ),
  getCode: jest.fn(async (address: string) =>
    address.toLowerCase() === CUSTOM_ADDR.toLowerCase() && hasCode
      ? '0x6080'
      : '0x'
  ),
});

describe('preflightCustomValidatorInstall', () => {
  it('passes a fresh validator module', async () => {
    const result = await preflightCustomValidatorInstall(
      providerFor({ hasCode: true, isValidator: true }),
      { address: CUSTOM_ADDR, chainId: 5700, metadata: metadataWith([]) }
    );
    expect(result).toEqual({ failures: [], ok: true });
  });

  it('rejects addresses without code (and skips the module probe)', async () => {
    const provider = providerFor({ hasCode: false, isValidator: true });
    const result = await preflightCustomValidatorInstall(provider, {
      address: CUSTOM_ADDR,
      chainId: 5700,
      metadata: metadataWith([]),
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('no-contract-code');
    expect(provider.call).not.toHaveBeenCalled();
  });

  it('rejects contracts that are not validator modules', async () => {
    const result = await preflightCustomValidatorInstall(
      providerFor({ hasCode: true, isValidator: false }),
      { address: CUSTOM_ADDR, chainId: 5700, metadata: metadataWith([]) }
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('not-a-validator-module');
  });

  it('rejects duplicates', async () => {
    const result = await preflightCustomValidatorInstall(
      providerFor({ hasCode: true, isValidator: true }),
      {
        address: CUSTOM_ADDR,
        chainId: 5700,
        metadata: metadataWith([customModule]),
      }
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('already-installed');
  });
});

describe('isPaliSignableValidator', () => {
  it('treats builtin single validators as signable', () => {
    expect(
      isPaliSignableValidator(ecdsaModule, metadataWith([ecdsaModule]))
    ).toBe(true);
  });

  it('treats custom validators as not signable', () => {
    expect(
      isPaliSignableValidator(customModule, metadataWith([customModule]))
    ).toBe(false);
  });

  it('requires threshold-many signable children for composites', () => {
    const composite = compositeOf([ECDSA_ADDR, CUSTOM_ADDR], 1);
    const metadata = metadataWith([ecdsaModule, customModule, composite]);
    expect(isPaliSignableValidator(composite, metadata)).toBe(true);

    const strictComposite = compositeOf([ECDSA_ADDR, CUSTOM_ADDR], 2);
    expect(
      isPaliSignableValidator(
        strictComposite,
        metadataWith([ecdsaModule, customModule, strictComposite])
      )
    ).toBe(false);

    const customOnly = compositeOf([CUSTOM_ADDR], 1);
    expect(
      isPaliSignableValidator(
        customOnly,
        metadataWith([customModule, customOnly])
      )
    ).toBe(false);
  });
});

describe('assertValidatorActivationAllowed (lockout guard)', () => {
  it('allows activating builtin validators', () => {
    expect(() =>
      assertValidatorActivationAllowed(metadataWith([ecdsaModule]), ECDSA_ADDR)
    ).not.toThrow();
  });

  it('refuses activating a custom validator as sole signer', () => {
    expect(() =>
      assertValidatorActivationAllowed(
        metadataWith([ecdsaModule, customModule]),
        CUSTOM_ADDR
      )
    ).toThrow(SmartAccountLockoutError);
  });

  it('allows a composite containing a signable sibling', () => {
    const composite = compositeOf([ECDSA_ADDR, CUSTOM_ADDR], 1);
    expect(() =>
      assertValidatorActivationAllowed(
        metadataWith([ecdsaModule, customModule, composite]),
        COMPOSITE_ADDR
      )
    ).not.toThrow();
  });

  it('refuses a composite whose only children are custom', () => {
    const composite = compositeOf([CUSTOM_ADDR], 1);
    expect(() =>
      assertValidatorActivationAllowed(
        metadataWith([customModule, composite]),
        COMPOSITE_ADDR
      )
    ).toThrow(SmartAccountLockoutError);
  });

  it('refuses validators that are not installed', () => {
    expect(() =>
      assertValidatorActivationAllowed(metadataWith([]), CUSTOM_ADDR)
    ).toThrow(SmartAccountLockoutError);
  });
});

describe('listCompositeChildCandidates', () => {
  it('lists installed non-composite validators', () => {
    const composite = compositeOf([ECDSA_ADDR], 1);
    const metadata = metadataWith([ecdsaModule, customModule, composite]);
    const candidates = listCompositeChildCandidates(metadata);
    expect(candidates.map((candidate) => candidate.address)).toEqual([
      ECDSA_ADDR,
      CUSTOM_ADDR,
    ]);
  });
});
