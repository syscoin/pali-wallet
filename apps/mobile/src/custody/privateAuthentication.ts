import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';

export type NativePrivateAuthenticationScope = Readonly<{
  isAuthenticating(): boolean;
  retire(): void;
}>;
declare const bindingBrand: unique symbol;
export type NativePrivateAuthentication = Readonly<{ [bindingBrand]: true }>;
type Active = { cancel(): void; signal: AbortSignal; assertCurrent(): void; isPromptActive(): boolean };
type State = { live: boolean; active: Active | null; parent: State | null; children: Set<State> };
type Binding = { state: State; scope: NativePrivateAuthenticationScope; assertCurrent(): void; isPromptActive(): boolean };
const scopes = new WeakMap<NativePrivateAuthenticationScope, State>();
const bindings = new WeakMap<NativePrivateAuthentication, Binding>();
const stale = () => new Error('CANCELLED');

function activeWithin(state: State): { owner: State; value: Active } | null {
  if (!state.live) return null;
  if (state.active) return { owner: state, value: state.active };
  for (const child of state.children) {
    const active = activeWithin(child);
    if (active) return active;
  }
  return null;
}
function retire(state: State): void {
  state.live = false;
  state.active?.cancel();
  state.active = null;
  for (const child of [...state.children]) retire(child);
  state.children.clear();
  state.parent?.children.delete(state);
}
function createScope(parent: State | null): NativePrivateAuthenticationScope {
  const state: State = { live: true, active: null, parent, children: new Set() };
  parent?.children.add(state);
  const scope = Object.freeze({
    isAuthenticating() {
      const found = activeWithin(state);
      if (!found || found.value.signal.aborted) return false;
      const { owner, value: active } = found;
      try {
        assertSynchronousEvmFeeGuard(active.assertCurrent);
        const prompt: unknown = active.isPromptActive();
        if (prompt !== true && prompt && (typeof prompt === 'object' || typeof prompt === 'function'))
          void Promise.resolve(prompt).catch(() => undefined);
        return state.live && owner.live && owner.active === active && !active.signal.aborted && prompt === true;
      } catch { active.cancel(); if (owner.active === active) owner.active = null; return false; }
    },
    retire() { retire(state); },
  });
  scopes.set(scope, state);
  return scope;
}

/** View-owned interruption status only. This object never authorizes an operation. */
export function createNativePrivateAuthenticationScope(): NativePrivateAuthenticationScope {
  return createScope(null);
}
/** Each child effect owns a fresh scope; retiring it never retires the parent view. */
export function createNativePrivateAuthenticationChild(parent: NativePrivateAuthenticationScope): NativePrivateAuthenticationScope {
  const state = scopes.get(parent);
  if (!state?.live) throw stale();
  return createScope(state);
}

/** Native factory only: bind a genuine view scope to its captured wallet and OS prompt. */
export function bindNativePrivateAuthentication(scope: NativePrivateAuthenticationScope, ports: Readonly<{
  assertCurrent(): void;
  isPromptActive(): boolean;
}>): NativePrivateAuthentication {
  const state = scopes.get(scope);
  if (!state?.live || typeof ports.assertCurrent !== 'function' || typeof ports.isPromptActive !== 'function') throw stale();
  assertSynchronousEvmFeeGuard(ports.assertCurrent);
  if (!state.live) throw stale();
  const binding = Object.freeze({}) as NativePrivateAuthentication;
  bindings.set(binding, { state, scope, ...ports });
  return binding;
}
export function bindNativePrivateAuthenticationChild(parent: NativePrivateAuthentication, child: NativePrivateAuthenticationScope): NativePrivateAuthentication {
  assertNativePrivateAuthentication(parent);
  const owner = bindings.get(parent)!;
  const state = scopes.get(child);
  if (!state?.live || state.parent !== owner.state) throw stale();
  return bindNativePrivateAuthentication(child, {
    assertCurrent: owner.assertCurrent,
    isPromptActive: owner.isPromptActive,
  });
}
export function assertNativePrivateAuthentication(binding: NativePrivateAuthentication): void {
  const value = bindings.get(binding);
  if (!value?.state.live) throw stale();
  assertSynchronousEvmFeeGuard(value.assertCurrent);
  if (!value.state.live) throw stale();
}
export function nativePrivateAuthenticationScope(binding: NativePrivateAuthentication): NativePrivateAuthenticationScope {
  assertNativePrivateAuthentication(binding);
  return bindings.get(binding)!.scope;
}

/** Private-view credential acquisition only; clear on cancellation and never borrow another active marker. */
export async function withNativePrivateAuthentication<T>(binding: NativePrivateAuthentication, signal: AbortSignal,
  assertOwner: () => void, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  assertNativePrivateAuthentication(binding);
  assertSynchronousEvmFeeGuard(assertOwner);
  const value = bindings.get(binding)!;
  let root = value.state;
  while (root.parent) root = root.parent;
  if (signal.aborted || activeWithin(root)) throw stale();
  const controller = new AbortController();
  const active: Active = { cancel: () => controller.abort(), signal: controller.signal, isPromptActive: value.isPromptActive,
    assertCurrent() { assertNativePrivateAuthentication(binding); assertSynchronousEvmFeeGuard(assertOwner); } };
  value.state.active = active;
  const clear = () => { controller.abort(); if (value.state.active === active) value.state.active = null; };
  signal.addEventListener('abort', clear, { once: true });
  try {
    active.assertCurrent();
    if (!value.state.live || signal.aborted || value.state.active !== active) throw stale();
    const result = await work(controller.signal);
    active.assertCurrent();
    if (controller.signal.aborted || value.state.active !== active) throw stale();
    return result;
  } finally { clear(); signal.removeEventListener('abort', clear); }
}
