import { getAddress } from '../ethersV6Compat';

import {
  buildECDSAAuthenticator,
  buildP256WebAuthnAuthenticator,
} from './authenticators';
import { paliSmartAccountInterface } from './contracts';
import {
  assertSmartAccountBuiltinInstallApplied,
  assertSmartAccountBuiltinInstallCurrent,
  buildSmartAccountBuiltinInstall,
} from './moduleCommands';
import { buildSmartAccountValidatorSwitch } from './validatorSwitch';
import type { ISmartAccountMetadata } from '../../types/network';

const accountAddress = getAddress(`0x${'11'.repeat(20)}`);
const source = buildECDSAAuthenticator({
  chainId: 57057,
  config: { owners: [getAddress(`0x${'22'.repeat(20)}`)], threshold: 1 },
});
const target = buildP256WebAuthnAuthenticator({
  chainId: 57057,
  config: {
    publicKey: {
      x: `0x${'33'.repeat(32)}`,
      y: `0x${'44'.repeat(32)}`,
      originHash: `0x${'55'.repeat(32)}`,
      rpIdHash: `0x${'66'.repeat(32)}`,
      originLength: 30,
    },
  },
});
const metadata = (): ISmartAccountMetadata => ({
  chainId: 57057,
  isDeployed: true,
  contractVersion: '1',
  deploymentSalt: `0x${'00'.repeat(32)}`,
  auth: { ...source.auth },
  installedModules: structuredClone(source.metadata.installedModules),
});
const build = (value = metadata()) =>
  buildSmartAccountBuiltinInstall({
    accountAddress,
    chainId: 57057,
    metadata: value,
    target,
  });
const applied = (): ISmartAccountMetadata => ({
  ...metadata(),
  installedModules: [
    ...source.metadata.installedModules!,
    ...target.metadata.installedModules!,
  ],
});

it('installs a canonical built-in then restores the exact active method, without uninstalling it', () => {
  const command = build();
  expect(command.purpose).toBe('add-to-combined');
  const calls = command.executions.map(
    (execution) =>
      paliSmartAccountInterface.parseTransaction({ data: execution.data })!
  );
  expect(calls.map((call) => call.name)).toEqual([
    'installModule',
    'rotateValidator',
  ]);
  expect(calls[0].args[1]).toBe(getAddress(target.auth.validator));
  expect(calls[1].args[0]).toBe(source.auth.validator);
  expect(calls[1].args[2]).toBe(source.auth.data);
  expect(Object.isFrozen(command)).toBe(true);
  expect(Object.isFrozen(command.executions[0])).toBe(true);
  assertSmartAccountBuiltinInstallCurrent(command, metadata());
  assertSmartAccountBuiltinInstallApplied(command, applied());
});

it('leaves the existing replacement command and uninstall semantics intact', () => {
  const command = buildSmartAccountValidatorSwitch({
    accountAddress,
    chainId: 57057,
    metadata: metadata(),
    target,
  });
  expect(command.purpose).toBe('replace');
  expect(
    command.executions.map(
      (execution) =>
        paliSmartAccountInterface.parseTransaction({ data: execution.data })!
          .name
    )
  ).toEqual(['installModule', 'uninstallModule']);
});

it('refuses duplicate, active, undeployed and foreign-chain additions', () => {
  expect(() => build(applied())).toThrow();
  expect(() =>
    buildSmartAccountBuiltinInstall({
      accountAddress,
      chainId: 57057,
      metadata: metadata(),
      target: source,
    })
  ).toThrow();
  expect(() => build({ ...metadata(), isDeployed: false })).toThrow();
  expect(() => build({ ...metadata(), chainId: 1 })).toThrow();
});

it('refuses mutated target config or a non-canonical built-in address', () => {
  const changed = structuredClone(target);
  (
    changed.metadata.installedModules![0] as any
  ).config.publicKey.x = `0x${'77'.repeat(32)}`;
  expect(() =>
    buildSmartAccountBuiltinInstall({
      accountAddress,
      chainId: 57057,
      metadata: metadata(),
      target: changed,
    })
  ).toThrow();
  const foreign = structuredClone(target);
  foreign.auth.validator = accountAddress;
  foreign.metadata.installedModules![0].address = accountAddress;
  expect(() =>
    buildSmartAccountBuiltinInstall({
      accountAddress,
      chainId: 57057,
      metadata: metadata(),
      target: foreign,
    })
  ).toThrow();
});

it('does not admit an arbitrary custom module through the built-in action', () => {
  const custom = structuredClone(target) as any;
  custom.auth.module = 'custom';
  custom.metadata.installedModules[0] = {
    ...custom.metadata.installedModules[0],
    id: 'custom',
    config: {
      initData: target.auth.data,
      name: 'Custom',
      compositeCompatible: true,
    },
  };
  expect(() =>
    buildSmartAccountBuiltinInstall({
      accountAddress,
      chainId: 57057,
      metadata: metadata(),
      target: custom,
    })
  ).toThrow();
});

it('refuses source changes and installation races before signing', () => {
  const command = build();
  const changed = metadata();
  changed.auth!.data = '0x1234';
  expect(() =>
    assertSmartAccountBuiltinInstallCurrent(command, changed)
  ).toThrow();
  expect(() =>
    assertSmartAccountBuiltinInstallCurrent(command, applied())
  ).toThrow();
  expect(() =>
    assertSmartAccountBuiltinInstallCurrent(
      { ...command, purpose: 'replace' } as any,
      metadata()
    )
  ).toThrow();
});

it('requires observed target configuration and unchanged original active authentication', () => {
  const command = build();
  expect(() =>
    assertSmartAccountBuiltinInstallApplied(command, metadata())
  ).toThrow();
  expect(() =>
    assertSmartAccountBuiltinInstallApplied(command, {
      ...applied(),
      auth: { ...target.auth },
    })
  ).toThrow();
  const changed = structuredClone(applied());
  (changed.installedModules![1] as any).config.publicKey.y = `0x${'88'.repeat(
    32
  )}`;
  expect(() =>
    assertSmartAccountBuiltinInstallApplied(command, changed)
  ).toThrow();
  const missingActive = applied();
  missingActive.installedModules = target.metadata.installedModules;
  expect(() =>
    assertSmartAccountBuiltinInstallApplied(command, missingActive)
  ).toThrow();
  const changedActive = structuredClone(applied());
  (changedActive.installedModules![0] as any).config.threshold = 2;
  expect(() =>
    assertSmartAccountBuiltinInstallApplied(command, changedActive)
  ).toThrow();
});
