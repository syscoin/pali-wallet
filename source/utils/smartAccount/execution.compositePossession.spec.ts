import { webcrypto } from 'crypto';
import { Wallet } from 'ethers/wallet';

import type { ISmartAccountMetadata } from 'types/network';
import { SLH_DSA_SIGNATURE_LENGTH } from 'utils/slhDsa/constants';

import {
  captureCompositePolicyChange,
  createCompositePolicyPossession,
} from './compositePossession';
import { getPaliModuleAddress } from './contracts';
import { signAndSubmitSmartAccountExecutions } from './execution';
import { buildCompositeValidatorExecutions } from './moduleCommands';

const accountAddress = `0x${'ab'.repeat(20)}`;
const ecdsa = `0x${'cd'.repeat(20)}`;
const slh = `0x${'ef'.repeat(20)}`;
const transactionHash = `0x${'12'.repeat(32)}`;
const owner = new Wallet(`0x${'34'.repeat(32)}`);
const contextId = 'composite-context';
const metadata: ISmartAccountMetadata = {
  chainId: 57057,
  contractVersion: '1',
  deploymentSalt: `0x${'00'.repeat(32)}`,
  isDeployed: true,
  auth: { module: 'ecdsa', validator: ecdsa, data: '0x' },
  installedModules: [
    {
      type: 'validator',
      id: 'ecdsa',
      address: ecdsa,
      data: '0x',
      config: { owners: [owner.address], threshold: 1 },
    },
    {
      type: 'validator',
      id: 'slh-dsa',
      address: slh,
      data: '0x',
      config: {
        keyId: 'fixture-slh',
        parameterSet: 'SLH-DSA-SHA2-128-24',
        pkRoot: `0x${'56'.repeat(32)}`,
        pkSeed: `0x${'78'.repeat(32)}`,
        signatureLimit: 100,
      },
    },
  ],
};
const executions = buildCompositeValidatorExecutions({
  accountAddress,
  metadata,
  children: [ecdsa, slh],
  threshold: 2,
  compositeValidatorAddress: getPaliModuleAddress(57057, 'composite'),
  isAlgorithmAvailable: () => true,
});

const setup = (options: { cancel?: boolean; rejectProofs?: boolean } = {}) => {
  const feePayer = {
    address: owner.address,
    id: 1,
    type: 'HDAccount' as const,
  };
  const entryPointFeeQuote = {
    executionContextId: contextId,
    feePayer,
    gasUnits: '1600',
    maximumFeeWei: '3200',
  };
  const proposal = captureCompositePolicyChange({
    accountAddress,
    metadata,
    executions,
  })!;
  const challenge = {
    ...createCompositePolicyPossession({
      proposal,
      accountAddress,
      chainId: 57057,
      executionContextId: contextId,
      preparedActionHash: transactionHash,
      expiresAt: Date.now() + 60_000,
      nonce: `0x${'90'.repeat(32)}`,
    }),
    accountId: 0,
    executionContextId: contextId,
  };
  const events: string[] = [];
  const signCurrent = jest.fn(async ({ actionHash }) => {
    events.push('sign-current');
    expect(actionHash).toBe(transactionHash);
    return owner.signingKey.sign(actionHash).serialized;
  });
  const signSlh = jest.fn(async ({ actionHash, executionContextId }) => {
    events.push('sign-proposed-slh');
    expect(actionHash).toBe(challenge.intent.actionHash);
    expect(actionHash).not.toBe(transactionHash);
    expect(executionContextId).toBe(contextId);
    return `0x${'aa'.repeat(SLH_DSA_SIGNATURE_LENGTH)}`;
  });
  const emitter = jest.fn(
    async ([, method]: string[], args: any[]): Promise<unknown> => {
      if (
        method === 'prepareSmartAccountExecutions' ||
        method === 'reuseSmartAccountExecutions'
      )
        return {
          accountId: 0,
          actionHash: transactionHash,
          executionContextId: contextId,
          executions,
          smartAccount: metadata,
          requiresCompositePossession: true,
          gasPayer: feePayer,
          entryPointFeeQuote,
          userOperation: {
            accountGasLimits:
              '0x' +
              BigInt(1000).toString(16).padStart(32, '0') +
              BigInt(500).toString(16).padStart(32, '0'),
            preVerificationGas: '100',
            gasFees:
              '0x' +
              BigInt(1).toString(16).padStart(32, '0') +
              BigInt(2).toString(16).padStart(32, '0'),
          },
        };
      if (method === 'assertSmartAccountExecutionContext') return;
      if (method === 'approveSmartAccountExecutionFeeQuote') {
        events.push('initial-approved');
        expect(args).toEqual([contextId, entryPointFeeQuote]);
        return;
      }
      if (method === 'getSmartAccountCompositePossession') return challenge;
      if (method === 'signSmartAccountCompositeOwner') {
        events.push('sign-proposed-owner');
        expect(args).toEqual([contextId, { id: 1, type: 'HDAccount' }]);
        if (options.cancel)
          throw Object.assign(new Error('Cancelled'), { code: 4001 });
        return owner.signingKey.sign(challenge.intent.actionHash).serialized;
      }
      if (method === 'verifySmartAccountCompositePossession') {
        const signatures = args[1] as string[];
        const verifiedChildren = options.rejectProofs
          ? []
          : proposal.children
              .filter((_, index) => signatures[index] !== '0x')
              .map((child) => child.address);
        events.push(`verified:${verifiedChildren.length}`);
        return {
          verifiedChildren,
          threshold: 2,
          satisfied: verifiedChildren.length === 2,
        };
      }
      if (method === 'submitSmartAccountExecution') {
        events.push('submit');
        return { hash: 'public-fixture-ack' };
      }
      throw new Error(`Unexpected method ${method}`);
    }
  );
  const params = {
    accountAddress,
    accountId: 0,
    controllerEmitter: emitter,
    executions,
    smartAccount: metadata,
    feeConsent: {
      confirmEntryPoint: jest.fn(async () => {
        events.push('initial-consent');
        return contextId;
      }),
      confirmFee: jest.fn(async (review: { id: string }) => review.id),
    },
    authenticatorContexts: {
      ecdsa: {
        localOwners: [{ address: owner.address, id: 1, type: 'HDAccount' }],
        signActionHash: signCurrent,
      },
      'slh-dsa': { signActionHash: signSlh },
    },
  };
  return { challenge, emitter, events, params, signCurrent, signSlh };
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
});

it('proves the proposed threshold on a separate challenge before the current transaction policy signs', async () => {
  const f = setup();
  await expect(signAndSubmitSmartAccountExecutions(f.params)).resolves.toEqual({
    hash: 'public-fixture-ack',
  });
  expect(f.events).toEqual([
    'initial-consent',
    'initial-approved',
    'sign-proposed-owner',
    'verified:1',
    'sign-proposed-slh',
    'verified:2',
    'sign-current',
    'submit',
  ]);
  expect(f.signCurrent).toHaveBeenCalledTimes(1);
  const submission = f.emitter.mock.calls.find(
    ([[, method]]) => method === 'submitSmartAccountExecution'
  ) as unknown[];
  expect(submission[4]).toEqual({ confirmFee: f.params.feeConsent.confirmFee });
});

it('rejects a missing backend EntryPoint quote before any authentication even without a UI callback', async () => {
  const f = setup();
  const invoke = f.emitter.getMockImplementation()!;
  f.emitter.mockImplementation(async (methods, args) => {
    const result = await invoke(methods, args);
    if (methods[1] === 'prepareSmartAccountExecutions') {
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw new Error('Expected the prepared fixture');
      const missing: Record<string, unknown> = { ...result };
      delete missing.entryPointFeeQuote;
      return missing;
    }
    return result;
  });
  await expect(
    signAndSubmitSmartAccountExecutions({ ...f.params, feeConsent: undefined })
  ).rejects.toThrow('Invalid smart account fee quote');
  expect(f.events).toEqual([]);
  expect(f.signCurrent).not.toHaveBeenCalled();
  expect(f.signSlh).not.toHaveBeenCalled();
});

it('requires actual initial consent when no earlier EntryPoint ceiling was reviewed', async () => {
  const f = setup();
  await expect(
    signAndSubmitSmartAccountExecutions({ ...f.params, feeConsent: undefined })
  ).rejects.toThrow('fee approval is required');
  expect(f.events).toEqual([]);
  expect(f.signCurrent).not.toHaveBeenCalled();
});

it.each(['fee', 'payer'])(
  'rejects a changed %s against the earlier reviewed cap before initial ACK or signing',
  async (changed) => {
    const f = setup();
    await expect(
      signAndSubmitSmartAccountExecutions({
        ...f.params,
        approvedFeeQuote: {
          executionContextId: contextId,
          maximumFeeWei: changed === 'fee' ? '3199' : '3200',
          feePayer: {
            address: changed === 'payer' ? accountAddress : owner.address,
            id: 1,
            type: 'HDAccount',
          },
        },
      })
    ).rejects.toMatchObject({
      message: 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED',
      transactionNotBroadcast: true,
    });
    expect(f.events).toEqual([]);
    expect(f.signCurrent).not.toHaveBeenCalled();
  }
);

it('declining the initial EntryPoint charge prevents possession and current-policy signing', async () => {
  const f = setup();
  f.params.feeConsent.confirmEntryPoint.mockResolvedValue(null as any);
  await expect(
    signAndSubmitSmartAccountExecutions(f.params)
  ).rejects.toMatchObject({ code: 4001, transactionNotBroadcast: true });
  expect(f.events).toEqual([]);
  expect(f.signCurrent).not.toHaveBeenCalled();
  expect(f.signSlh).not.toHaveBeenCalled();
});

it('reuses an existing reviewed EntryPoint ceiling but still acknowledges the exact prepared context', async () => {
  const f = setup();
  await signAndSubmitSmartAccountExecutions({
    ...f.params,
    approvedFeeQuote: {
      executionContextId: contextId,
      maximumFeeWei: '3200',
      feePayer: { address: owner.address, id: 1, type: 'HDAccount' },
    },
  });
  expect(f.params.feeConsent.confirmEntryPoint).not.toHaveBeenCalled();
  expect(f.events[0]).toBe('initial-approved');
  expect(f.events).toContain('submit');
});

it('does not sign the current transaction when the proposed child proofs fail verification', async () => {
  const f = setup({ rejectProofs: true });
  await expect(signAndSubmitSmartAccountExecutions(f.params)).rejects.toThrow(
    'cannot be proved'
  );
  expect(f.signCurrent).not.toHaveBeenCalled();
  expect(f.events).not.toContain('submit');
});

it('preserves cancellation without signing the current policy or submitting', async () => {
  const f = setup({ cancel: true });
  await expect(
    signAndSubmitSmartAccountExecutions(f.params)
  ).rejects.toMatchObject({
    code: 4001,
  });
  expect(f.signCurrent).not.toHaveBeenCalled();
  expect(f.signSlh).not.toHaveBeenCalled();
  expect(f.events).not.toContain('submit');
});

it('retires a held possession lookup before any authenticator entry when its UI scope changes', async () => {
  const f = setup();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let markLookupStarted!: () => void;
  const lookupStarted = new Promise<void>(
    (resolve) => (markLookupStarted = resolve)
  );
  const invoke = f.emitter.getMockImplementation()!;
  f.emitter.mockImplementation(async (methods, args) => {
    if (methods[1] === 'getSmartAccountCompositePossession') {
      markLookupStarted();
      await held;
    }
    return invoke(methods, args);
  });
  let current = true;
  const signing = signAndSubmitSmartAccountExecutions({
    ...f.params,
    onBeforeAuthentication: () => {
      if (!current) throw new Error('Retired UI');
    },
  });
  await lookupStarted;
  current = false;
  release();
  await expect(signing).rejects.toThrow('Retired UI');
  expect(f.signCurrent).not.toHaveBeenCalled();
  expect(f.signSlh).not.toHaveBeenCalled();
  expect(f.events).not.toContain('submit');
});
