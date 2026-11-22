import {
  defaultAbiCoder,
  getAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
  TypedDataEncoder,
} from '../ethersV6Compat.ts';
import { assertJsonWorkBudget } from '../requestPayloadBudget.ts';

import {
  encodeCompositeValidatorInitData,
  type SmartAccountExecution,
} from './account.ts';
import {
  SmartAccountExternalSignatureRequired,
  smartAccountAuthenticatorPriority,
} from './authenticatorDispatch.ts';
import {
  getPaliModuleAddress,
  paliSmartAccountInterface,
} from './contracts.ts';
import { buildCompositeValidatorExecutions } from './moduleCommands.ts';
import { createSmartAccountTypedSigningIntent } from './ownerSigningIntent.ts';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../types/network.ts';

export type CompositePolicyChange = Readonly<{
  accountAddress: string;
  chainId: number;
  children: readonly SmartAccountValidatorModule[];
  executions: readonly Readonly<SmartAccountExecution>[];
  smartAccount: ISmartAccountMetadata;
  sourceConfiguration: string;
  threshold: number;
  validator: Extract<SmartAccountValidatorModule, { id: 'composite' }>;
}>;

const invalid = (): never => {
  throw new Error('Combined approval possession changed');
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)])
    );
  return typeof value === 'string' && /^0x[\da-f]*$/i.test(value)
    ? value.toLowerCase()
    : value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const encodedCalls = (calls: readonly Readonly<SmartAccountExecution>[]) =>
  JSON.stringify(
    calls.map((call) => ({
      target: getAddress(call.target),
      value: BigInt(call.value).toString(),
      data: (call.data || '0x').toLowerCase(),
    }))
  );

export const compositeSourceConfiguration = (
  metadata: ISmartAccountMetadata
): string =>
  JSON.stringify(
    canonical({
      auth: metadata.auth,
      installedModules: metadata.installedModules,
    })
  );

/** Recognize the actual canonical configuration calls, never a renderer flag. */
export function captureCompositePolicyChange(
  input: Readonly<{
    accountAddress: string;
    executions: readonly Readonly<SmartAccountExecution>[];
    metadata: ISmartAccountMetadata;
  }>
): CompositePolicyChange | null {
  const accountAddress = getAddress(input.accountAddress),
    metadata = input.metadata;
  const installed =
    metadata.installedModules?.filter(
      (module): module is SmartAccountValidatorModule =>
        module.type === 'validator'
    ) ?? [];
  let target: string | undefined;
  let initData: string | undefined;
  for (const call of input.executions) {
    if (getAddress(call.target) !== accountAddress) continue;
    let decoded;
    try {
      decoded = paliSmartAccountInterface.parseTransaction({
        data: call.data || '0x',
      });
    } catch {
      continue;
    }
    if (
      decoded?.name !== 'installModule' &&
      decoded?.name !== 'rotateValidator'
    )
      continue;
    if (target === undefined) {
      try {
        target = getAddress(
          installed.find((module) => module.id === 'composite')?.address ??
            getPaliModuleAddress(metadata.chainId, 'composite')
        );
      } catch {
        continue;
      }
    }
    if (
      decoded?.name === 'installModule' &&
      BigInt(decoded.args[0]) === BigInt(1) &&
      getAddress(decoded.args[1]) === target
    ) {
      if (initData !== undefined) return invalid();
      initData = decoded.args[2];
    } else if (
      decoded?.name === 'rotateValidator' &&
      getAddress(decoded.args[0]) === target
    ) {
      if (initData !== undefined) return invalid();
      initData = decoded.args[2];
    }
  }
  if (initData === undefined) return null;
  if (!target) return invalid();
  const [rawChildren, rawThreshold] = defaultAbiCoder.decode(
    ['address[]', 'uint64'],
    initData
  );
  const addresses = Array.from(rawChildren, (value) => getAddress(value)),
    threshold = Number(rawThreshold);
  if (
    addresses.length > 64 ||
    encodeCompositeValidatorInitData(addresses, threshold).toLowerCase() !==
      initData.toLowerCase()
  )
    return invalid();
  const expected = buildCompositeValidatorExecutions({
    accountAddress,
    metadata,
    children: addresses,
    threshold,
    compositeValidatorAddress: target,
    isAlgorithmAvailable: (module) =>
      ['ecdsa', 'p256-webauthn', 'slh-dsa'].includes(module.id),
  });
  if (encodedCalls(expected) !== encodedCalls(input.executions))
    return invalid();
  const children = addresses.map((address) => {
    const module = installed.find(
      (candidate) => getAddress(candidate.address) === address
    );
    if (!module || module.id === 'composite') return invalid();
    return module;
  });
  const validator: Extract<SmartAccountValidatorModule, { id: 'composite' }> = {
    type: 'validator',
    id: 'composite',
    address: target,
    data: initData,
    config: { childValidators: addresses, threshold },
  };
  const captured = JSON.parse(
    JSON.stringify({
      accountAddress,
      chainId: metadata.chainId,
      children,
      executions: input.executions.map(
        ({ target: callTarget, value, data }) => ({
          target: getAddress(callTarget),
          value: BigInt(value).toString(),
          data: (data || '0x').toLowerCase(),
        })
      ),
      threshold,
      validator,
      smartAccount: {
        ...metadata,
        auth: { module: 'composite', validator: target, data: initData },
        installedModules: [
          ...installed.filter((module) => module.id !== 'composite'),
          validator,
        ],
      },
      sourceConfiguration: compositeSourceConfiguration(metadata),
    })
  ) as CompositePolicyChange;
  return freeze(captured);
}

export function createCompositePolicyPossession(
  input: Readonly<{
    accountAddress: string;
    chainId: number;
    executionContextId: string;
    expiresAt: number;
    nonce: string;
    preparedActionHash: string;
    proposal: CompositePolicyChange;
  }>
) {
  const { proposal, executionContextId, preparedActionHash, expiresAt, nonce } =
    input;
  if (
    getAddress(input.accountAddress) !== proposal.accountAddress ||
    input.chainId !== proposal.chainId ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    typeof executionContextId !== 'string' ||
    !executionContextId.length ||
    executionContextId.length > 128 ||
    !isHexString(preparedActionHash, 32) ||
    !isHexString(nonce, 32)
  )
    return invalid();
  const domain = {
    name: 'Pali combined approval possession',
    version: '1',
    chainId: input.chainId,
    verifyingContract: proposal.accountAddress,
  };
  const types = {
    CombinedApprovalPossession: [
      { name: 'childValidators', type: 'address[]' },
      { name: 'threshold', type: 'uint64' },
      { name: 'configurationHash', type: 'bytes32' },
      { name: 'executionsHash', type: 'bytes32' },
      { name: 'preparedActionHash', type: 'bytes32' },
      { name: 'contextHash', type: 'bytes32' },
      { name: 'expiresAt', type: 'uint64' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };
  const message = {
    childValidators: proposal.validator.config.childValidators,
    threshold: proposal.threshold,
    configurationHash: keccak256(
      toUtf8Bytes(
        JSON.stringify(
          canonical({
            source: proposal.sourceConfiguration,
            children: proposal.children,
          })
        )
      )
    ),
    executionsHash: keccak256(toUtf8Bytes(encodedCalls(proposal.executions))),
    preparedActionHash,
    contextHash: keccak256(toUtf8Bytes(executionContextId)),
    expiresAt,
    nonce,
  };
  const intent = createSmartAccountTypedSigningIntent(
    'policy-possession',
    { domain, types, message },
    TypedDataEncoder.hash(domain, types, message)
  );
  return freeze({
    intent,
    validator: proposal.validator,
    smartAccount: proposal.smartAccount,
    proposal,
  });
}

export async function verifyCompositePolicyPossession(
  input: Readonly<{
    actionHash: string;
    assertCurrent(): void;
    proposal: CompositePolicyChange;
    signatures: readonly string[];
    verifyChild(
      child: SmartAccountValidatorModule,
      signature: string
    ): Promise<boolean>;
  }>
): Promise<readonly string[]> {
  input.assertCurrent();
  if (
    !isHexString(input.actionHash, 32) ||
    !Array.isArray(input.signatures) ||
    input.signatures.length !== input.proposal.children.length
  )
    return invalid();
  assertJsonWorkBudget(input.signatures, 4 * 1024 * 1024);
  const verified: string[] = [];
  for (let index = 0; index < input.signatures.length; index++) {
    const signature = input.signatures[index],
      child = input.proposal.children[index]!;
    if (
      typeof signature !== 'string' ||
      !isHexString(signature) ||
      signature.length > 131074
    )
      return invalid();
    if (signature === '0x') continue;
    if (!['ecdsa', 'p256-webauthn', 'slh-dsa'].includes(child.id))
      return invalid();
    input.assertCurrent();
    const valid = await input.verifyChild(child, signature);
    input.assertCurrent();
    if (valid === true) verified.push(getAddress(child.address));
  }
  if (new Set(verified).size !== verified.length) return invalid();
  return Object.freeze(verified);
}

export async function collectCompositePolicyPossession(
  input: Readonly<{
    assertCurrent(): void;
    proposal: CompositePolicyChange;
    sign(
      child: SmartAccountValidatorModule,
      index: number
    ): Promise<string | null>;
    verify(signatures: readonly string[]): Promise<
      Readonly<{
        satisfied: boolean;
        threshold: number;
        verifiedChildren: readonly string[];
      }>
    >;
  }>
): Promise<void> {
  const signatures = input.proposal.children.map(() => '0x');
  const candidates = input.proposal.children
    .map((child, index) => ({ child, index }))
    .filter(({ child }) => smartAccountAuthenticatorPriority(child) >= 0)
    .sort(
      (a, b) =>
        smartAccountAuthenticatorPriority(a.child) -
          smartAccountAuthenticatorPriority(b.child) || a.index - b.index
    );
  for (const { child, index } of candidates) {
    input.assertCurrent();
    let signature: string | null;
    try {
      signature = await input.sign(child, index);
    } catch (error) {
      input.assertCurrent();
      if (error instanceof SmartAccountExternalSignatureRequired) continue;
      if (
        child.id === 'slh-dsa' &&
        error &&
        typeof error === 'object' &&
        Object.getOwnPropertyDescriptor(error, 'code')?.value ===
          'COMPOSITE_CHILD_UNAVAILABLE'
      )
        continue;
      throw error;
    }
    input.assertCurrent();
    if (signature === null) continue;
    signatures[index] = signature;
    const result = await input.verify(Object.freeze([...signatures]));
    input.assertCurrent();
    const addresses = result.verifiedChildren.map(getAddress);
    if (
      result.threshold !== input.proposal.threshold ||
      new Set(addresses).size !== addresses.length ||
      addresses.some(
        (address) =>
          !input.proposal.children.some(
            (module) => getAddress(module.address) === address
          )
      ) ||
      result.satisfied !== addresses.length >= input.proposal.threshold
    )
      return invalid();
    if (result.satisfied) return;
  }
  throw new Error('The selected approval rule cannot be proved on this device');
}
