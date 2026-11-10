import assert from 'node:assert/strict';
import { bindNativePrivateAuthentication, createNativePrivateAuthenticationChild, createNativePrivateAuthenticationScope, nativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../../src/custody/privateAuthentication.ts';
import type { KeyringRuntime } from '../../src/custody/keyringRuntime.ts';
import type { NativeNoteInventory } from '../../src/custody/noteBackupRuntime.ts';

const inventories = new WeakMap<NativeNoteInventory, NativePrivateAuthenticationScope>();

/** Direct-runtime tests have no OS prompt; preserve their existing current-owner guard. */
export function createTestPrivateAuthentication(assertCurrent: () => void) {
  return bindNativePrivateAuthentication(createNativePrivateAuthenticationScope(), { assertCurrent, isPromptActive: () => false });
}

export async function readTestNoteInventory(runtime: KeyringRuntime, assertCurrent: () => void): Promise<NativeNoteInventory> {
  const authentication = createTestPrivateAuthentication(assertCurrent);
  const inventory = await runtime.readNoteInventory!(assertCurrent, authentication);
  inventories.set(inventory, nativePrivateAuthenticationScope(authentication));
  return inventory;
}

export function testInventoryAuthentication(inventory: NativeNoteInventory): NativePrivateAuthenticationScope {
  const scope = inventories.get(inventory);
  assert(scope, 'Withdrawal must use its captured inventory authentication scope');
  return createNativePrivateAuthenticationChild(scope);
}
