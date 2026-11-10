import { AddressZero, getAddress, isHexString } from '../../../../source/utils/ethersV6Compat.ts';
import { encodeCompositeValidatorInitData, encodeEcdsaValidatorInitData, encodeSLHDSAValidatorInitData, getSmartAccountAuthHash, type SmartAccountExecution } from '../../../../source/utils/smartAccount/account.ts';
import { encodeP256WebAuthnAuthData } from '../../../../source/utils/passkey/account.ts';
import { getAvailablePaliModules } from '../../../../source/utils/smartAccount/capabilities.ts';
import { getPaliModuleAddress } from '../../../../source/utils/smartAccount/contracts.ts';
import { buildCompositeValidatorExecutions, buildCustomValidatorInstallExecutions, buildValidatorUninstallExecutions, canRemoveValidatorModule, type ValidatorModuleRemovalPolicy } from '../../../../source/utils/smartAccount/moduleCommands.ts';
import { getInstalledValidatorModuleByAddress, listInstalledValidatorModules } from '../../../../source/utils/smartAccount/modules.ts';
import type { ISmartAccountMetadata, SmartAccountValidatorModule } from '../../../../source/types/network.ts';

export type NativeSmartModuleDraft =
  | Readonly<{ kind: 'install-custom'; address: string; name: string; initData: string }>
  | Readonly<{ kind: 'uninstall'; address: string }>
  | Readonly<{ kind: 'composite'; children: readonly string[]; threshold: number }>;

export type NativeSmartModuleConsent =
  | Readonly<{ kind: 'install-custom'; riskAcknowledged: true }>
  | Readonly<{ kind: 'uninstall' | 'composite' }>;

export type NativeSmartModuleDeploymentAdmission = 'deployed-only' | 'constructor-or-deployed';

export type NativeSmartModuleCommand = Readonly<{
  draft: NativeSmartModuleDraft;
  accountAddress: string;
  chainId: number;
  deploymentAdmission: NativeSmartModuleDeploymentAdmission;
  removalPolicy: ValidatorModuleRemovalPolicy;
  sourceIsDeployed: boolean;
  sourceAuthHash: string;
  sourceAuthModule: NonNullable<NonNullable<ISmartAccountMetadata['auth']>['module']>;
  sourceModuleFingerprint: string;
  executions: readonly Readonly<SmartAccountExecution>[];
  targetAddress: string;
}>;

const changed = () => new Error('Smart account modules changed');
const invalid = (): never => { throw new Error('Invalid public Smart account module draft'); };
const address = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 128) return invalid();
  const result = getAddress(value.trim());
  if (result === AddressZero) return invalid();
  return result;
};
const own = (input: unknown, fields: readonly string[]): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== fields.length || fields.some(field => !descriptors[field] || !Object.hasOwn(descriptors[field], 'value'))) return invalid();
  return Object.fromEntries(fields.map(field => [field, descriptors[field]!.value]));
};

/** Copy bounded public input only. On-chain custom-module preflight belongs to the host. */
export function snapshotNativeSmartModuleDraft(input: unknown): NativeSmartModuleDraft {
  const kind = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'kind')?.value : undefined;
  if (kind === 'install-custom') {
    const draft = own(input, ['kind', 'address', 'name', 'initData']);
    if (typeof draft.name !== 'string' || draft.name.length > 120 || typeof draft.initData !== 'string' || draft.initData.length > 131074 || !isHexString(draft.initData || '0x') || (draft.initData.length > 0 && draft.initData.length % 2 !== 0)) return invalid();
    const normalizedAddress = address(draft.address);
    return Object.freeze({ kind, address: normalizedAddress, name: draft.name.trim() || normalizedAddress, initData: (draft.initData || '0x').toLowerCase() });
  }
  if (kind === 'uninstall') {
    const draft = own(input, ['kind', 'address']);
    return Object.freeze({ kind, address: address(draft.address) });
  }
  if (kind === 'composite') {
    const draft = own(input, ['kind', 'children', 'threshold']);
    if (!Array.isArray(draft.children) || draft.children.length < 1 || draft.children.length > 64 || !Number.isSafeInteger(draft.threshold) || Number(draft.threshold) < 1 || Number(draft.threshold) > draft.children.length) return invalid();
    const children = Array.from({ length: draft.children.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(draft.children, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return invalid();
      return address(descriptor.value);
    });
    if (new Set(children).size !== children.length) return invalid();
    return Object.freeze({ kind, children: Object.freeze(children), threshold: draft.threshold as number });
  }
  return invalid();
}

// Object key/inventory order is incidental; owner and composite child order is not.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return typeof value === 'string' && /^0x[\da-f]*$/i.test(value) ? value.toLowerCase() : value;
}
function fingerprint(metadata: ISmartAccountMetadata): string {
  return JSON.stringify(canonical({
    auth: metadata.auth && { module: metadata.auth.module ?? metadata.auth.scheme, validator: getAddress(metadata.auth.validator), data: metadata.auth.data },
    modules: listInstalledValidatorModules(metadata).map(module => ({ id: module.id, address: getAddress(module.address), data: module.data ?? '0x', config: module.config })).sort((left, right) => left.address.toLowerCase().localeCompare(right.address.toLowerCase()) || left.id.localeCompare(right.id)),
  }));
}
function constructorData(module: SmartAccountValidatorModule): string {
  if (module.id === 'ecdsa') {
    const owners = module.config.owners.map(address), threshold = module.config.threshold;
    if (!owners.length || new Set(owners).size !== owners.length || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > owners.length) throw changed();
    return encodeEcdsaValidatorInitData(owners, threshold);
  }
  if (module.id === 'p256-webauthn') return encodeP256WebAuthnAuthData(module.config.publicKey);
  if (module.id === 'slh-dsa') return encodeSLHDSAValidatorInitData(module.config);
  if (module.id === 'composite') {
    const children = module.config.childValidators.map(address), threshold = module.config.threshold;
    if (!children.length || new Set(children).size !== children.length || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > children.length) throw changed();
    return encodeCompositeValidatorInitData(children, threshold);
  }
  throw changed();
}
function source(metadata: ISmartAccountMetadata, deploymentAdmission: NativeSmartModuleDeploymentAdmission) {
  const auth = metadata.auth, module = auth?.module ?? auth?.scheme;
  if ((deploymentAdmission !== 'deployed-only' && deploymentAdmission !== 'constructor-or-deployed') || !Number.isSafeInteger(metadata.chainId) || metadata.chainId < 1 || typeof metadata.isDeployed !== 'boolean' || (!metadata.isDeployed && deploymentAdmission !== 'constructor-or-deployed') || !auth || !module) throw changed();
  const active = getInstalledValidatorModuleByAddress(metadata, auth.validator);
  if (!active || active.id !== (auth.module ?? auth.scheme) || (active.data ?? '0x').toLowerCase() !== auth.data.toLowerCase()) throw changed();
  const hash = getSmartAccountAuthHash(auth);
  if (!metadata.isDeployed && (active.id === 'custom' || !metadata.deploymentAuth || getSmartAccountAuthHash(metadata.deploymentAuth) !== hash || getAddress(getPaliModuleAddress(metadata.chainId, active.id)) !== getAddress(active.address) || constructorData(active).toLowerCase() !== auth.data.toLowerCase())) throw changed();
  return { active, hash, module };
}

/** Public immutable command around the extension's builders; no preflight or signing authority. */
export function buildNativeSmartModuleCommand({ accountAddress, metadata, draft: input, isAlgorithmAvailable, removalPolicy, deploymentAdmission }: {
  accountAddress: string;
  metadata: ISmartAccountMetadata;
  draft: NativeSmartModuleDraft;
  isAlgorithmAvailable(module: SmartAccountValidatorModule): boolean;
  removalPolicy: ValidatorModuleRemovalPolicy;
  deploymentAdmission: NativeSmartModuleDeploymentAdmission;
}): NativeSmartModuleCommand {
  if (removalPolicy !== 'all-installed-composites' && removalPolicy !== 'active-composite') throw changed();
  const account = address(accountAddress), draft = snapshotNativeSmartModuleDraft(input), before = source(metadata, deploymentAdmission);
  let targetAddress: string, executions: SmartAccountExecution[];
  if (draft.kind === 'install-custom') {
    if (getInstalledValidatorModuleByAddress(metadata, draft.address) || !before.active.data) throw changed();
    targetAddress = draft.address;
    executions = buildCustomValidatorInstallExecutions({ accountAddress: account, activeValidatorAddress: before.active.address, activeValidatorData: before.active.data, customValidatorAddress: draft.address, customInitData: draft.initData });
  } else if (draft.kind === 'uninstall') {
    if (!canRemoveValidatorModule(metadata, draft.address, removalPolicy)) throw changed();
    targetAddress = draft.address;
    executions = buildValidatorUninstallExecutions({ accountAddress: account, validatorAddress: draft.address });
  } else {
    const installed = listInstalledValidatorModules(metadata).find(module => module.id === 'composite');
    const supported = getAvailablePaliModules(metadata.chainId).some(module => module.id === 'composite' && module.supported);
    targetAddress = installed?.address ?? getPaliModuleAddress(metadata.chainId, 'composite');
    executions = buildCompositeValidatorExecutions({ accountAddress: account, metadata, children: draft.children, threshold: draft.threshold, compositeValidatorAddress: supported ? targetAddress : null, isAlgorithmAvailable });
  }
  return Object.freeze({ draft, accountAddress: account, chainId: metadata.chainId, deploymentAdmission, removalPolicy, sourceIsDeployed: metadata.isDeployed, sourceAuthHash: before.hash, sourceAuthModule: before.module, sourceModuleFingerprint: fingerprint(metadata), targetAddress: getAddress(targetAddress), executions: Object.freeze(executions.map(execution => Object.freeze({ ...execution }))) });
}

export function assertNativeSmartModuleCommandCurrent(command: NativeSmartModuleCommand, observed: ISmartAccountMetadata): void {
  const current = source(observed, command.deploymentAdmission);
  if (observed.chainId !== command.chainId || observed.isDeployed !== command.sourceIsDeployed || current.hash !== command.sourceAuthHash || current.module !== command.sourceAuthModule || fingerprint(observed) !== command.sourceModuleFingerprint) throw changed();
}

/** Canonical observation is separate from transaction acknowledgement and may be retried. */
export function assertNativeSmartModuleCommandApplied(command: NativeSmartModuleCommand, observed: ISmartAccountMetadata): void {
  const current = source(observed, 'deployed-only'), target = getInstalledValidatorModuleByAddress(observed, command.targetAddress), draft = command.draft;
  if (observed.chainId !== command.chainId) throw changed();
  if (draft.kind === 'composite') {
    const data = encodeCompositeValidatorInitData([...draft.children], draft.threshold);
    if (target?.id !== 'composite' || target.config.threshold !== draft.threshold || target.config.childValidators.length !== draft.children.length || target.config.childValidators.some((child, index) => getAddress(child) !== draft.children[index]) || target.data?.toLowerCase() !== data.toLowerCase() || observed.auth!.validator.toLowerCase() !== command.targetAddress.toLowerCase() || observed.auth!.data.toLowerCase() !== data.toLowerCase() || current.module !== 'composite') throw changed();
  } else {
    // Custom init data is a durable local hint; hydration independently observes
    // isModuleInstalled, not arbitrary custom-validator configuration.
    if (current.hash !== command.sourceAuthHash || current.module !== command.sourceAuthModule || (draft.kind === 'uninstall' ? !!target : !target)) throw changed();
  }
}
