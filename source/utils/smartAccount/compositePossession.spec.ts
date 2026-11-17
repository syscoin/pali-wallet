import { getAddress } from '../ethersV6Compat';

import {
  captureCompositePolicyChange,
  collectCompositePolicyPossession,
  createCompositePolicyPossession,
  verifyCompositePolicyPossession,
} from './compositePossession';
import { getPaliModuleAddress } from './contracts';
import { buildCompositeValidatorExecutions } from './moduleCommands';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../types/network';

const address = (n: number) =>
  getAddress(`0x${n.toString(16).padStart(40, '0')}`);
const account = address(100);
const ecdsa: SmartAccountValidatorModule = {
  type: 'validator',
  id: 'ecdsa',
  address: address(1),
  data: '0x12',
  config: { owners: [address(80)], threshold: 1 },
};
const passkey: SmartAccountValidatorModule = {
  type: 'validator',
  id: 'p256-webauthn',
  address: address(2),
  data: '0x34',
  config: {
    publicKey: {
      x: '0x' + '11'.repeat(32),
      y: '0x' + '22'.repeat(32),
      rpIdHash: '0x' + '33'.repeat(32),
      originHash: '0x' + '44'.repeat(32),
      originLength: 20,
    },
  },
};
const metadata = () =>
  ({
    chainId: 1,
    isDeployed: true,
    auth: { module: 'ecdsa', validator: ecdsa.address, data: '0x12' },
    installedModules: [ecdsa, passkey],
  } as ISmartAccountMetadata);
const proposal = (
  threshold = 1,
  children = [passkey.address, ecdsa.address]
) => {
  const value = metadata();
  const executions = buildCompositeValidatorExecutions({
    accountAddress: account,
    metadata: value,
    children,
    threshold,
    compositeValidatorAddress: getPaliModuleAddress(1, 'composite'),
    isAlgorithmAvailable: () => true,
  });
  return captureCompositePolicyChange({
    accountAddress: account,
    metadata: value,
    executions,
  })!;
};
const noop = () => undefined;

describe('combined policy possession', () => {
  it('recognizes actual canonical calls and freezes the exact proposed child order/configurations', () => {
    const value = proposal();
    expect(value.children.map((child) => child.address)).toEqual([
      passkey.address,
      ecdsa.address,
    ]);
    expect(value.smartAccount.auth!.module).toBe('composite');
    expect(Object.isFrozen(value.children[0].config)).toBe(true);
    expect(
      captureCompositePolicyChange({
        accountAddress: account,
        metadata: metadata(),
        executions: [{ target: address(90), value: '0x0', data: '0x' }],
      })
    ).toBeNull();
    expect(
      captureCompositePolicyChange({
        accountAddress: account,
        metadata: { ...metadata(), chainId: 987654321 },
        executions: [{ target: address(90), value: '0x0', data: '0x' }],
      })
    ).toBeNull();
    expect(() =>
      captureCompositePolicyChange({
        accountAddress: account,
        metadata: metadata(),
        executions: [
          ...value.executions,
          { target: address(90), value: '0x0', data: '0x' },
        ],
      })
    ).toThrow();
  });
  it('uses a fresh typed challenge that is distinct from the configuration transaction hash', () => {
    const value = proposal(),
      expiresAt = Date.now() + 60000;
    const args = {
      proposal: value,
      accountAddress: account,
      chainId: 1,
      executionContextId: 'owned-context',
      preparedActionHash: '0x' + '33'.repeat(32),
      expiresAt,
      nonce: '0x' + '44'.repeat(32),
    };
    const challenge = createCompositePolicyPossession(args);
    expect(challenge.intent.purpose).toBe('policy-possession');
    expect(challenge.intent.actionHash).not.toBe(args.preparedActionHash);
    expect(challenge.intent.representation).toBe('eip712');
    for (const change of [
      { executionContextId: 'another-context' },
      { preparedActionHash: '0x' + '55'.repeat(32) },
      { expiresAt: expiresAt + 1 },
      { nonce: '0x' + '66'.repeat(32) },
      { proposal: proposal(2) },
      { proposal: proposal(1, [ecdsa.address, passkey.address]) },
    ])
      expect(
        createCompositePolicyPossession({ ...args, ...change }).intent
          .actionHash
      ).not.toBe(challenge.intent.actionHash);
    expect(() =>
      createCompositePolicyPossession({ ...args, accountAddress: address(101) })
    ).toThrow();
    expect(() =>
      createCompositePolicyPossession({ ...args, chainId: 2 })
    ).toThrow();
    expect(() =>
      createCompositePolicyPossession({ ...args, expiresAt: Date.now() - 1 })
    ).toThrow();
  });
  it('counts only actually verified distinct children and permits an incomplete vector', async () => {
    const value = proposal(2),
      verifyChild = jest.fn(
        async (child: SmartAccountValidatorModule) => child.id === 'ecdsa'
      );
    expect(
      await verifyCompositePolicyPossession({
        proposal: value,
        actionHash: '0x' + '33'.repeat(32),
        signatures: ['0x', '0x1234'],
        assertCurrent: noop,
        verifyChild,
      })
    ).toEqual([ecdsa.address]);
    expect(verifyChild).toHaveBeenCalledTimes(1);
    expect(
      await verifyCompositePolicyPossession({
        proposal: value,
        actionHash: '0x' + '33'.repeat(32),
        signatures: ['0x1234', '0xabcd'],
        assertCurrent: noop,
        verifyChild,
      })
    ).toEqual([ecdsa.address]);
  });
  it('bounds malformed proof vectors before calling an installed child', async () => {
    const value = proposal(),
      verifyChild = jest.fn(async () => true);
    for (const signatures of [
      [],
      ['0x1234'],
      ['0xzz', '0x'],
      ['0x' + '11'.repeat(65537), '0x'],
    ])
      await expect(
        verifyCompositePolicyPossession({
          proposal: value,
          actionHash: '0x' + '33'.repeat(32),
          signatures,
          assertCurrent: noop,
          verifyChild,
        })
      ).rejects.toThrow();
    expect(verifyChild).not.toHaveBeenCalled();
  });
  it('proves a sufficient ECDSA alternative without prompting the optional unavailable passkey, preserving policy slots', async () => {
    const value = proposal(),
      sign = jest.fn(async () => '0x1234'),
      verify = jest.fn(async (signatures: readonly string[]) => {
        expect(signatures).toEqual(['0x', '0x1234']);
        return {
          verifiedChildren: [ecdsa.address],
          threshold: 1,
          satisfied: true,
        };
      });
    await collectCompositePolicyPossession({
      proposal: value,
      assertCurrent: noop,
      sign,
      verify,
    });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign.mock.calls[0]).toEqual([value.children[1], 1]);
  });
  it('does not count a successful callback with a rejected proof and can prove another optional child', async () => {
    const value = proposal(),
      sign = jest.fn(async () => '0x1234'),
      verify = jest.fn(async (signatures: readonly string[]) => {
        const verifiedChildren =
          signatures[0] !== '0x' ? [passkey.address] : [];
        return {
          verifiedChildren,
          threshold: 1,
          satisfied: verifiedChildren.length === 1,
        };
      });
    await collectCompositePolicyPossession({
      proposal: value,
      assertCurrent: noop,
      sign,
      verify,
    });
    expect(sign).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledTimes(2);
  });
  it.each(['ecdsa', 'slh-dsa'] as const)(
    'skips a genuinely unavailable optional %s child and proves a later passkey',
    async (kind) => {
      const value = metadata();
      const unavailable: SmartAccountValidatorModule =
        kind === 'ecdsa'
          ? ecdsa
          : {
              type: 'validator',
              id: 'slh-dsa',
              address: address(3),
              data: '0xab',
              config: {
                keyId: 'local-state-missing',
                parameterSet: 'SLH-DSA-SHA2-128-24',
                pkRoot: '0x' + '11'.repeat(32),
                pkSeed: '0x' + '22'.repeat(32),
                signatureLimit: 8,
              },
            };
      value.installedModules = [unavailable, passkey];
      const executions = buildCompositeValidatorExecutions({
        accountAddress: account,
        metadata: value,
        children: [unavailable.address, passkey.address],
        threshold: 1,
        compositeValidatorAddress: getPaliModuleAddress(1, 'composite'),
        isAlgorithmAvailable: () => true,
      });
      const captured = captureCompositePolicyChange({
        accountAddress: account,
        metadata: value,
        executions,
      })!;
      const sign = jest.fn(async (child: SmartAccountValidatorModule) =>
        child.id === kind ? null : '0x1234'
      );
      await collectCompositePolicyPossession({
        proposal: captured,
        assertCurrent: noop,
        sign,
        verify: async (signatures) => {
          expect(signatures).toEqual(['0x', '0x1234']);
          return {
            verifiedChildren: [passkey.address],
            threshold: 1,
            satisfied: true,
          };
        },
      });
      expect(sign).toHaveBeenCalledTimes(2);
    }
  );
  it('cannot activate a passkey-only policy after its unavailable credential fails', async () => {
    const value = proposal(1, [passkey.address]),
      verify = jest.fn(),
      submit = jest.fn();
    const work = async () => {
      await collectCompositePolicyPossession({
        proposal: value,
        assertCurrent: noop,
        sign: async () => {
          throw Object.assign(Error('Cancelled'), { name: 'NotAllowedError' });
        },
        verify,
      });
      submit();
    };
    await expect(work()).rejects.toThrow('Cancelled');
    expect(verify).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('keeps the current policy usable when a required second credential is cancelled', async () => {
    const value = proposal(2),
      submit = jest.fn(),
      sign = jest.fn(async (child: SmartAccountValidatorModule) => {
        if (child.id === 'p256-webauthn') throw Error('User cancelled');
        return '0x1234';
      });
    const work = async () => {
      await collectCompositePolicyPossession({
        proposal: value,
        assertCurrent: noop,
        sign,
        verify: async () => ({
          verifiedChildren: [ecdsa.address],
          threshold: 2,
          satisfied: false,
        }),
      });
      submit();
    };
    await expect(work()).rejects.toThrow('User cancelled');
    expect(sign).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
  });
  it('retires a held proof before verification or transaction signing', async () => {
    const value = proposal(),
      held = Promise.withResolvers<string>(),
      verify = jest.fn(),
      submit = jest.fn();
    let current = true;
    const work = async () => {
      await collectCompositePolicyPossession({
        proposal: value,
        assertCurrent: () => {
          if (!current) throw Error('retired');
        },
        sign: () => held.promise,
        verify,
      });
      submit();
    };
    const pending = work();
    current = false;
    held.resolve('0x1234');
    await expect(pending).rejects.toThrow('retired');
    expect(verify).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
