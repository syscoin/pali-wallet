import { webcrypto } from 'crypto';

import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from 'types/network';
import { defaultAbiCoder } from 'utils/ethersV6Compat';
import { signP256WebAuthnActionHash } from 'utils/passkey/authenticator';
import { SLH_DSA_SIGNATURE_LENGTH } from 'utils/slhDsa/constants';

import { getPaliModuleAddress, paliSmartAccountInterface } from './contracts';
import { isPaliSignableValidator } from './custom';
import {
  signAndSubmitSmartAccountExecutions,
  signSmartAccountActionHash,
  SmartAccountExternalSignatureRequired,
} from './execution';

jest.mock('utils/passkey/authenticator', () => ({
  ...jest.requireActual('utils/passkey/authenticator'),
  signP256WebAuthnActionHash: jest.fn(),
}));

const COMPOSITE = `0x${'11'.repeat(20)}`;
const P256 = `0x${'22'.repeat(20)}`;
const ECDSA = `0x${'33'.repeat(20)}`;
const OWNER = `0x${'44'.repeat(20)}`;
const ACTION_HASH = `0x${'55'.repeat(32)}`;
const ECDSA_SIGNATURE = `0x${'66'.repeat(65)}`;
const P256_SIGNATURE = '0x7788';
const SLH = `0x${'cc'.repeat(20)}`;
const CUSTOM = `0x${'dd'.repeat(20)}`;
const SLH_SIGNATURE = `0x${'ee'.repeat(SLH_DSA_SIGNATURE_LENGTH)}`;
const ACCOUNT = `0x${'ef'.repeat(20)}`;

const slhComposite = () => {
  const smartAccount = metadata(1);
  smartAccount.installedModules!.push({
    address: SLH,
    config: {
      keyId: 'composite-pq-key',
      parameterSet: 'SLH-DSA-SHA2-128-24',
      pkRoot: `0x${'12'.repeat(32)}`,
      pkSeed: `0x${'34'.repeat(32)}`,
      signatureLimit: 100,
    },
    id: 'slh-dsa',
    type: 'validator',
  });
  compositeModule(smartAccount).config.childValidators = [SLH];
  return smartAccount;
};

const localEcdsaContext = (
  signActionHash = jest.fn().mockResolvedValue(ECDSA_SIGNATURE)
) => ({
  localOwners: [{ address: OWNER, id: 0, type: 'HDAccount' }],
  signActionHash,
});

const compositeModule = (smartAccount: ISmartAccountMetadata) =>
  smartAccount.installedModules!.find(
    (module) => module.id === 'composite'
  ) as Extract<SmartAccountValidatorModule, { id: 'composite' }>;

const metadata = (threshold: number) => {
  const composite: SmartAccountValidatorModule = {
    address: COMPOSITE,
    config: { childValidators: [ECDSA, P256], threshold },
    id: 'composite',
    type: 'validator',
  };
  return {
    auth: { data: '0x', module: 'composite', validator: COMPOSITE },
    chainId: 57057,
    installedModules: [
      {
        address: ECDSA,
        config: { owners: [OWNER], threshold: 1 },
        id: 'ecdsa',
        type: 'validator',
      },
      {
        address: P256,
        config: {
          credentialId: 'c3ludGhldGlj',
          credentialIdHash: `0x${'77'.repeat(32)}`,
          publicKey: {
            x: `0x${'88'.repeat(32)}`,
            y: `0x${'99'.repeat(32)}`,
            originHash: `0x${'aa'.repeat(32)}`,
            originLength: 32,
            rpIdHash: `0x${'bb'.repeat(32)}`,
          },
        },
        id: 'p256-webauthn',
        type: 'validator',
      },
      composite,
    ],
    isDeployed: true,
  } as ISmartAccountMetadata;
};

describe('normal local composite approvals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(signP256WebAuthnActionHash).mockResolvedValue({
      proof: {},
      signature: P256_SIGNATURE,
    } as any);
  });

  it.each([1, 2])(
    'signs a %i-of-2 all-local policy that the wallet accepts as signable',
    async (threshold) => {
      const smartAccount = metadata(threshold);
      const composite = smartAccount.installedModules!.find(
        (module) => module.id === 'composite'
      ) as SmartAccountValidatorModule;
      expect(isPaliSignableValidator(composite, smartAccount)).toBe(true);
      const signEcdsa = jest.fn().mockResolvedValue(ECDSA_SIGNATURE);

      // Real production dispatcher and child drivers; only cryptographic I/O
      // is synthetic. No signature, RPC, chain or browser capability is used.
      const result = await signSmartAccountActionHash({
        accountId: 7,
        actionHash: ACTION_HASH,
        authenticatorContexts: {
          ecdsa: {
            localOwners: [{ address: OWNER, id: 0, type: 'HDAccount' }],
            signActionHash: signEcdsa,
          },
        },
        executionContextId: 'approved-composite-operation',
        smartAccount,
      });

      const signatures = defaultAbiCoder.decode(
        ['bytes[]'],
        result.signature
      )[0];
      expect(result.validator?.toLowerCase()).toBe(COMPOSITE);
      expect(signatures).toHaveLength(2);
      expect(
        signatures.filter((signature: string) => signature !== '0x')
      ).toHaveLength(threshold);
      expect(signEcdsa).toHaveBeenCalledWith({
        actionHash: ACTION_HASH,
        executionContextId: 'approved-composite-operation',
        owner: { address: OWNER, id: 0, type: 'HDAccount' },
      });
      expect(signatures[0]).toBe(ECDSA_SIGNATURE);
      if (threshold === 2) {
        expect(signP256WebAuthnActionHash).toHaveBeenCalledTimes(1);
        expect(signatures[1]).toBe(P256_SIGNATURE);
      }
    }
  );

  it('keeps configured child order, progress and the exact action context', async () => {
    const smartAccount = metadata(2);
    compositeModule(smartAccount).config.childValidators = [P256, ECDSA];
    const events: string[] = [];
    const signEcdsa = jest.fn().mockResolvedValue(ECDSA_SIGNATURE);
    const result = await signSmartAccountActionHash({
      accountId: 7,
      actionHash: ACTION_HASH,
      authenticatorContexts: { ecdsa: localEcdsaContext(signEcdsa) },
      executionContextId: 'same-approved-operation',
      onAuthenticatorSigningStarted: (id) => events.push(`start:${id}`),
      onAuthenticatorSigningResolved: (id) => events.push(`end:${id}`),
      smartAccount,
    });
    expect(
      Array.from(defaultAbiCoder.decode(['bytes[]'], result.signature)[0])
    ).toEqual([P256_SIGNATURE, ECDSA_SIGNATURE]);
    expect(events).toEqual([
      'start:composite',
      'start:p256-webauthn',
      'end:p256-webauthn',
      'start:ecdsa',
      'end:ecdsa',
      'end:composite',
    ]);
    expect(signP256WebAuthnActionHash).toHaveBeenCalledWith(
      expect.objectContaining({ actionHash: ACTION_HASH })
    );
    expect(signEcdsa).toHaveBeenCalledWith(
      expect.objectContaining({
        actionHash: ACTION_HASH,
        executionContextId: 'same-approved-operation',
      })
    );
  });

  it('pads an unavailable ECDSA approval instead of misaligning a later passkey', async () => {
    const result = await signSmartAccountActionHash({
      actionHash: ACTION_HASH,
      smartAccount: metadata(1),
    });
    expect(
      Array.from(defaultAbiCoder.decode(['bytes[]'], result.signature)[0])
    ).toEqual(['0x', P256_SIGNATURE]);
  });

  it('does not silently fall back after a passkey rejection', async () => {
    const smartAccount = metadata(1);
    compositeModule(smartAccount).config.childValidators = [P256, ECDSA];
    const denied = Object.assign(new Error('Passkey rejected'), {
      name: 'NotAllowedError',
    });
    jest.mocked(signP256WebAuthnActionHash).mockRejectedValue(denied);
    const signEcdsa = jest.fn().mockResolvedValue(ECDSA_SIGNATURE);
    await expect(
      signSmartAccountActionHash({
        actionHash: ACTION_HASH,
        authenticatorContexts: { ecdsa: localEcdsaContext(signEcdsa) },
        smartAccount,
      })
    ).rejects.toBe(denied);
    expect(signEcdsa).not.toHaveBeenCalled();
  });

  it('skips a compatible external child only when enough builtin children remain', async () => {
    const smartAccount = metadata(1);
    smartAccount.installedModules!.push({
      address: CUSTOM,
      config: { compositeCompatible: true, moduleType: 1, name: 'External' },
      id: 'custom',
      type: 'validator',
    });
    compositeModule(smartAccount).config.childValidators = [CUSTOM, ECDSA];
    const result = await signSmartAccountActionHash({
      actionHash: ACTION_HASH,
      authenticatorContexts: { ecdsa: localEcdsaContext() },
      smartAccount,
    });
    expect(
      Array.from(defaultAbiCoder.decode(['bytes[]'], result.signature)[0])
    ).toEqual(['0x', ECDSA_SIGNATURE]);
  });

  it('forwards the account, context and reserved-signature policy to an SLH child', async () => {
    const smartAccount = metadata(2);
    const slhConfig = {
      keyId: 'synthetic-composite-key',
      parameterSet: 'SLH-DSA-SHA2-128-24' as const,
      pkRoot: `0x${'12'.repeat(32)}`,
      pkSeed: `0x${'34'.repeat(32)}`,
      signatureLimit: 100,
    };
    smartAccount.installedModules!.push({
      address: SLH,
      config: slhConfig,
      id: 'slh-dsa',
      type: 'validator',
    });
    compositeModule(smartAccount).config.childValidators = [ECDSA, SLH];
    const signSlh = jest.fn().mockResolvedValue(SLH_SIGNATURE);
    const result = await signSmartAccountActionHash({
      accountId: 7,
      actionHash: ACTION_HASH,
      executionContextId: 'composite-context',
      allowReservedSLHDSASignature: true,
      authenticatorContexts: {
        ecdsa: localEcdsaContext(),
        'slh-dsa': { signActionHash: signSlh },
      },
      smartAccount,
    });
    expect(
      Array.from(defaultAbiCoder.decode(['bytes[]'], result.signature)[0])
    ).toEqual([ECDSA_SIGNATURE, SLH_SIGNATURE]);
    expect(signSlh).toHaveBeenCalledWith({
      accountId: 7,
      actionHash: ACTION_HASH,
      executionContextId: 'composite-context',
      allowReservedSignature: true,
      keyId: slhConfig.keyId,
      parameterSet: slhConfig.parameterSet,
      pkRoot: slhConfig.pkRoot,
      pkSeed: slhConfig.pkSeed,
    });
  });

  it.each([
    { children: [ECDSA, ECDSA], threshold: 2 },
    { children: [ECDSA, P256], threshold: 0 },
    { children: [ECDSA, P256], threshold: 1.5 },
    { children: [COMPOSITE, ECDSA], threshold: 1 },
    { children: [CUSTOM, ECDSA], threshold: 2 },
    { children: ['malformed', ECDSA], threshold: 1 },
  ])(
    'rejects an invalid or locally unavailable policy before child signing (%p)',
    async ({ children, threshold }) => {
      const smartAccount = metadata(threshold);
      compositeModule(smartAccount).config.childValidators = children;
      const signEcdsa = jest.fn().mockResolvedValue(ECDSA_SIGNATURE);
      await expect(
        signSmartAccountActionHash({
          actionHash: ACTION_HASH,
          authenticatorContexts: { ecdsa: localEcdsaContext(signEcdsa) },
          smartAccount,
        })
      ).rejects.toBeInstanceOf(SmartAccountExternalSignatureRequired);
      expect(signEcdsa).not.toHaveBeenCalled();
      expect(signP256WebAuthnActionHash).not.toHaveBeenCalled();
    }
  );
});
describe('composite submission and SLH reserve policy', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
  });

  const emitterFor = (smartAccount: ISmartAccountMetadata) =>
    jest.fn(async ([, method]: string[], payload: any[]) => {
      if (method === 'prepareSmartAccountExecutions')
        return {
          actionHash: ACTION_HASH,
          executionContextId: 'composite-background-context',
          executions: payload[0],
          smartAccount,
          userOperation: { sender: ACCOUNT },
        };
      if (method === 'assertSmartAccountExecutionContext') return;
      if (method === 'submitSmartAccountExecution') return payload[0];
      throw new Error(`Unexpected method ${method}`);
    });

  const rotation = (validator: string, target = ACCOUNT) => ({
    data: paliSmartAccountInterface.encodeFunctionData('rotateValidator', [
      validator,
      '0x',
      '0x1234',
    ]),
    target,
    value: '0x0',
  });
  const install = () => ({
    data: paliSmartAccountInterface.encodeFunctionData('installModule', [
      1,
      getPaliModuleAddress(57057, 'ecdsa'),
      '0x1234',
    ]),
    target: ACCOUNT,
    value: '0x0',
  });
  const uninstall = () => ({
    data: paliSmartAccountInterface.encodeFunctionData('uninstallModule', [
      1,
      COMPOSITE,
      '0x',
    ]),
    target: ACCOUNT,
    value: '0x0',
  });

  it.each([
    ['ordinary activity', [{ target: OWNER, value: '0x1', data: '0x' }], false],
    ['same composite reconfiguration', [rotation(COMPOSITE)], false],
    ['direct PQ reconfiguration', [rotation(SLH)], false],
    [
      'canonical ECDSA escape',
      [rotation(getPaliModuleAddress(57057, 'ecdsa'))],
      true,
    ],
    [
      'canonical passkey escape',
      [rotation(getPaliModuleAddress(57057, 'p256-webauthn'))],
      true,
    ],
    [
      'foreign account rotation',
      [rotation(getPaliModuleAddress(57057, 'ecdsa'), OWNER)],
      false,
    ],
    ['install without active composite removal', [install()], false],
    ['install and remove active composite', [install(), uninstall()], true],
    [
      'escape followed by reactivating the composite',
      [rotation(getPaliModuleAddress(57057, 'ecdsa')), rotation(COMPOSITE)],
      false,
    ],
  ] as const)(
    'uses reserved PQ signatures only for %s',
    async (_name, executions, expected) => {
      const smartAccount = slhComposite();
      const signSlh = jest.fn().mockResolvedValue(SLH_SIGNATURE);
      await signAndSubmitSmartAccountExecutions({
        accountAddress: ACCOUNT,
        accountId: 7,
        smartAccount,
        authenticatorContexts: { 'slh-dsa': { signActionHash: signSlh } },
        controllerEmitter: emitterFor(smartAccount),
        executions: [...executions],
      });
      expect(signSlh).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 7,
          actionHash: ACTION_HASH,
          executionContextId: 'composite-background-context',
          allowReservedSignature: expected,
        })
      );
    }
  );

  it('shares one in-flight internal composite submission without a second PQ signature', async () => {
    const smartAccount = slhComposite();
    const signSlh = jest.fn().mockResolvedValue(SLH_SIGNATURE);
    const controllerEmitter = emitterFor(smartAccount);
    const params = {
      accountAddress: ACCOUNT,
      accountId: 7,
      smartAccount,
      authenticatorContexts: { 'slh-dsa': { signActionHash: signSlh } },
      controllerEmitter,
      executions: [{ target: OWNER, value: '0x0', data: '0x' }],
    };
    // Hold both real SHA-256 results at a common barrier so calls overlap.
    // An already-completed operation is intentionally not cached.
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let completed = 0;
    let release!: () => void;
    const bothDigests = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observedDigest = jest
      .spyOn(crypto.subtle, 'digest')
      .mockImplementation(async (...args) => {
        const result = await digest(...args);
        if (++completed === 2) release();
        await bothDigests;
        return result;
      });
    let results: any[];
    try {
      results = await Promise.all([
        signAndSubmitSmartAccountExecutions(params),
        signAndSubmitSmartAccountExecutions(params),
      ]);
    } finally {
      observedDigest.mockRestore();
    }
    expect(results[0]).toBe(results[1]);
    expect(signSlh).toHaveBeenCalledTimes(1);
    expect(
      controllerEmitter.mock.calls.filter(
        ([[, method]]) => method === 'prepareSmartAccountExecutions'
      )
    ).toHaveLength(1);
    expect(
      controllerEmitter.mock.calls.filter(
        ([[, method]]) => method === 'submitSmartAccountExecution'
      )
    ).toHaveLength(1);
  });

  it.each([
    'encrypted storage write failed',
    'PALI_TRANSACTION_CONTEXT_CHANGED',
  ])('does not skip a PQ child after %s', async (message) => {
    const smartAccount = slhComposite();
    compositeModule(smartAccount).config.childValidators = [SLH, ECDSA];
    const signEcdsa = jest.fn().mockResolvedValue(ECDSA_SIGNATURE);
    const failure = new Error(message);
    await expect(
      signSmartAccountActionHash({
        actionHash: ACTION_HASH,
        smartAccount,
        authenticatorContexts: {
          ecdsa: localEcdsaContext(signEcdsa),
          'slh-dsa': { signActionHash: jest.fn().mockRejectedValue(failure) },
        },
      })
    ).rejects.toBe(failure);
    expect(signEcdsa).not.toHaveBeenCalled();
  });
});
