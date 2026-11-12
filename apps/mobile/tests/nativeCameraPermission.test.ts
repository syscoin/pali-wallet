import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createPermissionPresentation } from '../src/platform/permissionPresentation.ts';

type Permission = { granted: boolean; canAskAgain: boolean };
type Port = {
  isCameraPermissionPromptActive(): boolean;
  requestNativeCameraPermission(isCurrent: () => boolean): Promise<Permission>;
};
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  let state = 'active', requests = 0, reads = 0;
  let permission: Permission = { granted: false, canAskAgain: true };
  let pending = Promise.withResolvers<Permission>();
  const listeners = new Set<(state: string) => void>();
  const imports: Record<string, unknown> = {
    'react-native': { AppState: { get currentState() { return state; }, addEventListener(_name: string, listener: (value: string) => void) {
      listeners.add(listener); return { remove() { listeners.delete(listener); } };
    } } },
    'expo-camera': { Camera: {
      async getCameraPermissionsAsync() { reads++; return permission; },
      requestCameraPermissionsAsync() { requests++; return pending.promise; },
    } },
    './permissionPresentation': { createPermissionPresentation },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/platform/cameraPermission.native.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { port: module.exports as Port, listeners,
    get requests() { return requests; }, get reads() { return reads; },
    status(value: Permission) { permission = value; },
    move(value: string) { state = value; for (const listener of listeners) listener(value); },
    finish(value = { granted: true, canAskAgain: true }) { pending.resolve(value); },
    retry() { pending = Promise.withResolvers<Permission>(); },
  };
}
for (const granted of [true, false]) test(`camera OS ${granted ? 'grant' : 'refusal'} preserves only its owned inactive presentation`, async () => {
  const f = fixture();
  const result = f.port.requestNativeCameraPermission(() => true);
  await flush(); assert.equal(f.requests, 1); assert.equal(f.port.isCameraPermissionPromptActive(), true);
  f.move('inactive'); f.finish({ granted, canAskAgain: false }); await flush();
  assert.equal(f.port.isCameraPermissionPromptActive(), true);
  f.move('active'); assert.equal((await result).granted, granted);
  assert.equal(f.port.isCameraPermissionPromptActive(), false); assert.equal(f.listeners.size, 0);
});
test('background permanently retires a pending camera exception and rejects its late grant', async () => {
  const f = fixture();
  const result = f.port.requestNativeCameraPermission(() => true);
  const rejected = assert.rejects(result, /interrupted/);
  await flush(); f.move('background'); assert.equal(f.port.isCameraPermissionPromptActive(), false);
  f.move('active'); assert.equal(f.port.isCameraPermissionPromptActive(), false);
  f.finish(); await rejected; assert.equal(f.listeners.size, 0);
});
test('closing a scanner immediately removes its exception; a late result cannot clear the next prompt', async () => {
  const f = fixture(); let alive = true;
  const first = f.port.requestNativeCameraPermission(() => alive);
  const rejected = assert.rejects(first, /interrupted/);
  await flush(); alive = false; assert.equal(f.port.isCameraPermissionPromptActive(), false);
  await assert.rejects(f.port.requestNativeCameraPermission(() => true), /unavailable/);
  f.finish(); await rejected; f.retry();
  const second = f.port.requestNativeCameraPermission(() => true); await flush();
  assert.equal(f.port.isCameraPermissionPromptActive(), true); f.finish(); await second;
  assert.equal(f.port.isCameraPermissionPromptActive(), false); assert.equal(f.requests, 2);
});
test('already granted and permanently denied camera states do not create a prompt exception', async () => {
  const f = fixture();
  for (const permission of [{ granted: true, canAskAgain: true }, { granted: false, canAskAgain: false }]) {
    f.status(permission);
    assert.equal((await f.port.requestNativeCameraPermission(() => true)).granted, permission.granted);
    assert.equal(f.port.isCameraPermissionPromptActive(), false);
  }
  assert.equal(f.requests, 0); assert.equal(f.reads, 2); assert.equal(f.listeners.size, 0);
});
test('a retired scanner cannot even read permission or open a prompt', async () => {
  const f = fixture();
  await assert.rejects(f.port.requestNativeCameraPermission(() => false), /interrupted/);
  assert.equal(f.reads, 0); assert.equal(f.requests, 0);
});
