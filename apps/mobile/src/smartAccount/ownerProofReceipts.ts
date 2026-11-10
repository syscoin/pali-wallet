import { computeAddress } from 'ethers/transaction';

import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import {
  getAddress,
  isHexString,
} from '../../../../source/utils/ethersV6Compat.ts';
import {
  DAPP_REQUEST_LIMITS,
  measureJsonWorkBudget,
} from '../../../../source/utils/requestPayloadBudget.ts';
import {
  assertEcdsaOwnerSignature,
  type SmartAccountSigningPlan,
} from '../../../../source/utils/smartAccount/authenticatorDispatch.ts';
import {
  assertSmartAccountOwnerSigningIntent,
  type SmartAccountOwnerSigningIntent,
} from '../../../../source/utils/smartAccount/ownerSigningIntent.ts';

export type NativeOwnerProofIdentity = Readonly<{
  type: 'HDAccount' | 'Imported' | 'Ledger' | 'Trezor';
  /** SDK owner index, identical to the selected shared-plan owner id. */
  id: number;
  address: string;
  publicKey: string;
}>;
export type NativeOwnerProofStep = Readonly<{
  ordinal: number;
  validator: string;
  childIndex: number;
  owner: NativeOwnerProofIdentity;
}>;
declare const handleBrand: unique symbol;
export type NativeOwnerProofHandle = Readonly<{ [handleBrand]: true }>;
export type NativeOwnerProofCapture = Readonly<{
  /** Private host's exact wire/account/network/full-policy/owner-plan context. */
  binding: string;
  intent: SmartAccountOwnerSigningIntent;
  plan: SmartAccountSigningPlan;
  owners: readonly NativeOwnerProofIdentity[];
  expiresAt: number;
}>;
export type NativeOwnerProofRequest = Readonly<{
  binding: string;
  intent: SmartAccountOwnerSigningIntent;
  step: NativeOwnerProofStep;
}>;
type State = {
  binding: string;
  intent: SmartAccountOwnerSigningIntent;
  intentJson: string;
  steps: readonly NativeOwnerProofStep[];
  expiresAt: number;
  outputs: string[];
};

function fields(
  value: unknown,
  names: readonly string[]
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error('Invalid owner proof receipt data');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== names.length ||
    keys.some((key) => typeof key !== 'string' || !names.includes(key))
  )
    throw Error('Invalid owner proof receipt data');
  const copy: Record<string, unknown> = {};
  for (const name of names) {
    const property = Object.getOwnPropertyDescriptor(value, name);
    if (!property || !('value' in property))
      throw Error('Invalid owner proof receipt data');
    copy[name] = property.value;
  }
  return copy;
}
function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}
function jsonCopy<T>(value: T, budget: number = DAPP_REQUEST_LIMITS.bytes): T {
  measureJsonWorkBudget(value, budget);
  return freezeJson(JSON.parse(JSON.stringify(value)) as T);
}
function captureIntent(value: SmartAccountOwnerSigningIntent) {
  const intent = jsonCopy(value);
  fields(
    intent,
    intent.representation === 'eip712'
      ? ['actionHash', 'purpose', 'representation', 'typedData']
      : ['actionHash', 'purpose', 'representation', 'reason']
  );
  assertSmartAccountOwnerSigningIntent(intent);
  return { intent, json: JSON.stringify(intent) };
}
function binding(value: unknown): string {
  if (typeof value !== 'string' || !value.length)
    throw Error('Owner proof context is required');
  measureJsonWorkBudget(value);
  return value;
}
function identity(value: unknown): NativeOwnerProofIdentity {
  const owner = fields(value, ['type', 'id', 'address', 'publicKey']);
  if (
    typeof owner.type !== 'string' ||
    !['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(owner.type) ||
    !Number.isSafeInteger(owner.id) ||
    Number(owner.id) < 0 ||
    typeof owner.address !== 'string' ||
    typeof owner.publicKey !== 'string' ||
    !(isHexString(owner.publicKey, 33) || isHexString(owner.publicKey, 65))
  )
    throw Error('Invalid owner proof identity');
  const address = getAddress(owner.address);
  if (computeAddress(owner.publicKey) !== address)
    throw Error('Owner proof public key does not match owner');
  return Object.freeze({
    type: owner.type as NativeOwnerProofIdentity['type'],
    id: Number(owner.id),
    address,
    publicKey: owner.publicKey.toLowerCase(),
  });
}
function step(value: unknown): NativeOwnerProofStep {
  const input = fields(value, ['ordinal', 'validator', 'childIndex', 'owner']);
  if (
    !Number.isSafeInteger(input.ordinal) ||
    Number(input.ordinal) < 0 ||
    !Number.isSafeInteger(input.childIndex) ||
    Number(input.childIndex) < 0 ||
    typeof input.validator !== 'string'
  )
    throw Error('Invalid owner proof occurrence');
  return Object.freeze({
    ordinal: Number(input.ordinal),
    validator: getAddress(input.validator),
    childIndex: Number(input.childIndex),
    owner: identity(input.owner),
  });
}
function captureSteps(
  plan: SmartAccountSigningPlan,
  owners: readonly NativeOwnerProofIdentity[]
) {
  const captured = jsonCopy({ plan, owners });
  if (
    !Array.isArray(captured.plan.authenticators) ||
    !Array.isArray(captured.owners)
  )
    throw Error('Owner proof plan is required');
  const inventory = captured.owners.map(identity),
    steps: NativeOwnerProofStep[] = [];
  const identities = new Set<string>();
  for (const owner of inventory) {
    const key = `${owner.type}:${owner.id}`;
    if (identities.has(key)) throw Error('Owner proof identity is ambiguous');
    identities.add(key);
  }
  for (const entry of captured.plan.authenticators) {
    if (!entry || !Array.isArray(entry.owners))
      throw Error('Owner proof plan is required');
    if (entry.validator.id !== 'ecdsa') {
      if (entry.owners.length)
        throw Error('Only ECDSA owner proofs can be retained');
      continue;
    }
    for (const selected of entry.owners) {
      const selectedAddress = getAddress(selected.address);
      const owner = inventory.find(
        (candidate) =>
          candidate.type === selected.type &&
          candidate.id === selected.id &&
          candidate.address === selectedAddress
      );
      if (!owner) throw Error('Owner proof plan identity changed');
      steps.push(
        step({
          ordinal: steps.length,
          validator: entry.validator.address,
          childIndex: entry.index,
          owner,
        })
      );
    }
  }
  if (!steps.length) throw Error('An ECDSA owner proof plan is required');
  return Object.freeze(steps);
}

/** Internal proof outputs only. No renderer DTO, signing context, keyring or SDK session. */
export class NativeOwnerProofReceipts {
  readonly #states = new WeakMap<NativeOwnerProofHandle, State>();
  readonly #now: () => number;
  constructor(options: Readonly<{ now(): number }>) {
    const input = fields(options, ['now']);
    if (typeof input.now !== 'function')
      throw Error('Owner proof clock is required');
    this.#now = input.now as () => number;
  }
  private current(assertCurrent: () => void): number {
    if (typeof assertCurrent !== 'function')
      throw Error('Owner proof authority is required');
    assertSynchronousEvmFeeGuard(assertCurrent);
    const now = this.#now();
    assertSynchronousEvmFeeGuard(assertCurrent);
    if (!Number.isSafeInteger(now) || now < 0)
      throw Error('Invalid owner proof clock');
    return now;
  }
  capture(
    input: NativeOwnerProofCapture,
    assertCurrent: () => void
  ): Readonly<{
    handle: NativeOwnerProofHandle;
    steps: readonly NativeOwnerProofStep[];
    expiresAt: number;
  }> {
    const now = this.current(assertCurrent);
    const source = fields(input, [
      'binding',
      'intent',
      'plan',
      'owners',
      'expiresAt',
    ]);
    const bound = binding(source.binding),
      captured = captureIntent(source.intent as SmartAccountOwnerSigningIntent),
      steps = captureSteps(
        source.plan as SmartAccountSigningPlan,
        source.owners as readonly NativeOwnerProofIdentity[]
      ),
      expiresAt = source.expiresAt;
    if (
      typeof expiresAt !== 'number' ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt <= this.current(assertCurrent)
    )
      throw Error('Owner proof receipts expired');
    const handle = Object.freeze({}) as NativeOwnerProofHandle;
    this.#states.set(handle, {
      binding: bound,
      intent: captured.intent,
      intentJson: captured.json,
      steps,
      expiresAt,
      outputs: [],
    });
    return Object.freeze({ handle, steps, expiresAt });
  }
  private access(
    handle: NativeOwnerProofHandle,
    request: NativeOwnerProofRequest,
    assertCurrent: () => void
  ) {
    const state = this.#states.get(handle);
    if (!state) throw Error('Owner proof receipts retired');
    try {
      const now = this.current(assertCurrent);
      const source = fields(request, ['binding', 'intent', 'step']);
      const intent = captureIntent(
          source.intent as SmartAccountOwnerSigningIntent
        ),
        requested = step(source.step);
      if (
        now >= state.expiresAt ||
        binding(source.binding) !== state.binding ||
        intent.json !== state.intentJson ||
        JSON.stringify(requested) !==
          JSON.stringify(state.steps[requested.ordinal])
      )
        throw Error('Owner proof context changed or expired');
      if (requested.ordinal > state.outputs.length)
        throw Error('Owner proof order changed');
      if (this.current(assertCurrent) >= state.expiresAt)
        throw Error('Owner proof receipts expired');
      if (this.#states.get(handle) !== state)
        throw Error('Owner proof receipts retired');
      return { state, requested };
    } catch (error) {
      this.retire(handle);
      throw error;
    }
  }
  read(
    handle: NativeOwnerProofHandle,
    request: NativeOwnerProofRequest,
    assertCurrent: () => void
  ): string | null {
    const { state, requested } = this.access(handle, request, assertCurrent);
    return state.outputs[requested.ordinal] ?? null;
  }
  record(
    handle: NativeOwnerProofHandle,
    request: NativeOwnerProofRequest,
    signature: string,
    assertCurrent: () => void
  ): void {
    const { state, requested } = this.access(handle, request, assertCurrent);
    try {
      if (requested.ordinal !== state.outputs.length)
        throw Error('Owner proof order changed');
      assertEcdsaOwnerSignature(
        state.intent.actionHash,
        requested.owner.address,
        signature
      );
      if (this.current(assertCurrent) >= state.expiresAt)
        throw Error('Owner proof receipts expired');
      if (this.#states.get(handle) !== state)
        throw Error('Owner proof receipts retired');
      state.outputs.push(signature);
    } catch (error) {
      this.retire(handle);
      throw error;
    }
  }
  retire(handle: NativeOwnerProofHandle): void {
    const state = this.#states.get(handle);
    if (state) state.outputs.length = 0;
    this.#states.delete(handle);
  }
}
