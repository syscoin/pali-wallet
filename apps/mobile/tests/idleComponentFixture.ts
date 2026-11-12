import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import ts from 'typescript';
import { createSecurityRuntime } from '../src/core/securityRuntime.ts';
import { createTestPublicViewLock } from './publicViewLockFixture.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
const components = new WeakSet<object>();
/** Real runtime configured with explicit unit-test preferences, not an activity mock. */
export function createSecurityTestFixture() {
  // These navigation/rendering fixtures explicitly use the supported no-timeout
  // preference. Idle-expiry behavior has its own real-clock/interaction tests.
  const security = createSecurityRuntime({
    async get() { return JSON.stringify({ version: 1, custodyIdleMinutes: 0, watchIdleMinutes: 0 }); },
    async set() { assert.fail('This rendering fixture must not change security preferences'); },
  });
  return { ...security, publicViewLock: createTestPublicViewLock().viewLock };
}

/** Real runtime and real wrappers; only native rendering/storage are injected. */
export function createIdleComponentFixture(react: Record<string, any>, native: Record<string, unknown>) {
  const security = createSecurityTestFixture();
  const ready = security.securityPreferences.load();
  const runtime = { ...react, createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) =>
    react.createElement(type, props, ...(children.length ? children : props && Object.hasOwn(props, 'children') ? [props.children] : [])), forwardRef: (render: (props: object, ref: unknown) => unknown) =>
    (props: Record<string, unknown>) => render(props, props.ref ?? null) };
  const module = { exports: {} as Record<string, any> };
  const source = readFileSync(new NodeURL('../src/screens/IdleActivityBoundary.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const dependencies: Record<string, unknown> = { react: runtime, 'react-native': native, '../platform/security': security };
  runInNewContext(code, { module, exports: module.exports, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected idle fixture import ${name}`); return dependencies[name];
  } });
  for (const value of Object.values(module.exports)) if (typeof value === 'function') components.add(value);
  return { security, ready, components: module.exports };
}

/** Expand only the real idle wrappers, leaving tested parent/leaf identity intact. */
export function expandIdleElements(value: any): any {
  if (!value || typeof value !== 'object' || !('children' in value)) return value;
  let node = value as Element;
  if (typeof node.type === 'function' && components.has(node.type)) {
    const children = node.children.length === 1 ? node.children[0] : node.children;
    return expandIdleElements(node.type({ ...node.props, children }));
  }
  node = { ...node, children: node.children.flat(Infinity).map(expandIdleElements) };
  if (node.props.footer) node.props = { ...node.props, footer: expandIdleElements(node.props.footer) };
  return node;
}
