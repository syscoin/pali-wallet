import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  createPrivacyServiceSettings,
  DEFAULT_PRIVACY_SERVICE_ORIGIN,
  PRIVACY_SERVICE_ORIGIN_STORAGE_KEY,
} from '../../../source/shared/privacyServiceOrigin.ts';

function fixture() {
  let saved: unknown;
  const writes: string[] = [];
  const settings = createPrivacyServiceSettings({
    async read(key) {
      assert.equal(key, PRIVACY_SERVICE_ORIGIN_STORAGE_KEY);
      return saved;
    },
    async write(key, value) {
      assert.equal(key, PRIVACY_SERVICE_ORIGIN_STORAGE_KEY);
      saved = value;
      writes.push(value);
    },
  });
  return {
    settings,
    writes,
    setSaved(value: unknown) {
      saved = value;
    },
  };
}

test('shared settings preserve the default, stored origin validation and stable unchanged selection', async () => {
  const { settings, writes, setSaved } = fixture();
  const captured = await settings.capture();
  assert.equal(captured.origin, DEFAULT_PRIVACY_SERVICE_ORIGIN);
  assert.equal(Object.isFrozen(captured), true);
  await settings.changeOrigin(
    DEFAULT_PRIVACY_SERVICE_ORIGIN + '/',
    async () => {
      assert.fail('unchanged origin must not invalidate');
    }
  );
  captured.assertCurrent();
  assert.deepEqual(writes, []);
  setSaved('http://untrusted.example');
  await assert.rejects(settings.capture(), /privacy_service_origin_invalid/);
  setSaved('https://self-hosted.example/');
  assert.equal(
    (await settings.capture()).origin,
    'https://self-hosted.example'
  );
  assert.throws(
    () => createPrivacyServiceSettings({} as never),
    /privacy_service_storage_unavailable/
  );
});

test('changing the selected origin retires captures before invalidation and persistence finish', async () => {
  const { settings, writes } = fixture();
  const other = fixture();
  const captured = await settings.capture();
  const otherCapture = await other.settings.capture();
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const pending = settings.changeOrigin(
    'https://self-hosted.example',
    () => {
      began();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    captured.origin
  );
  await started;
  assert.throws(captured.assertCurrent, /privacy_service_changed/);
  await assert.rejects(settings.capture(), /privacy_service_changed/);
  otherCapture.assertCurrent();
  assert.deepEqual(writes, []);
  release();
  assert.equal(await pending, 'https://self-hosted.example');
  assert.deepEqual(writes, ['https://self-hosted.example']);
  assert.throws(captured.assertCurrent, /privacy_service_changed/);
  (await settings.capture()).assertCurrent();
  await assert.rejects(
    settings.changeOrigin(
      'https://second.example',
      async () => undefined,
      captured.origin
    ),
    /privacy_service_changed/
  );
});

test('a simultaneous unchanged request cannot succeed using the old origin', async () => {
  const { settings } = fixture();
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const changing = settings.changeOrigin('https://new.example', () => {
    began();
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const unchanged = settings.changeOrigin(
    DEFAULT_PRIVACY_SERVICE_ORIGIN,
    async () => undefined
  );
  // Attach both outcomes before asserting so a rejected race never leaks work.
  const result = Promise.allSettled([changing, unchanged]);
  await started;
  release();
  const [first, second] = await result;
  assert.equal(first?.status, 'fulfilled');
  assert.equal(second?.status, 'rejected');
  if (second?.status === 'rejected')
    assert.match(second.reason.message, /privacy_service_changed/);
});

test('stored settings require a string instead of URL object coercion', async () => {
  const { settings, setSaved } = fixture();
  for (const value of [
    { toString: () => 'https://coerced.example' },
    null,
    {},
  ]) {
    setSaved(value);
    await assert.rejects(settings.capture(), /privacy_service_origin_invalid/);
  }
});

test('failed invalidation keeps the selected origin while retiring old captures', async () => {
  const { settings, writes } = fixture();
  const captured = await settings.capture();
  await assert.rejects(
    settings.changeOrigin('https://self-hosted.example', async () => {
      throw new Error('invalidation failed');
    }),
    /invalidation failed/
  );
  assert.deepEqual(writes, []);
  assert.throws(captured.assertCurrent, /privacy_service_changed/);
  assert.equal(
    (await settings.capture()).origin,
    DEFAULT_PRIVACY_SERVICE_ORIGIN
  );
});

test('a settings read held across a selected-origin change cannot publish an old capture', async () => {
  let saved: string | undefined;
  let finish!: (value: unknown) => void;
  let hold = true;
  const settings = createPrivacyServiceSettings({
    read() {
      if (!hold) return Promise.resolve(saved);
      hold = false;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    async write(_key, value) {
      saved = value;
    },
  });
  const pending = settings.capture();
  await settings.changeOrigin('http://localhost:8800', async () => undefined);
  finish(undefined);
  await assert.rejects(pending, /privacy_service_changed/);
  assert.equal((await settings.capture()).origin, 'http://localhost:8800');
});

test('native settings use the shared policy and noninteractive device-only SecureStore preference', async () => {
  let saved: string | null = null;
  let available = true;
  const calls: { key: string; options: Record<string, unknown> }[] = [];
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
    async isAvailableAsync() {
      return available;
    },
    async getItemAsync(key: string, options: Record<string, unknown>) {
      calls.push({ key, options });
      return saved;
    },
    async setItemAsync(
      key: string,
      value: string,
      options: Record<string, unknown>
    ) {
      calls.push({ key, options });
      saved = value;
    },
  };
  const module = {
    exports: {} as {
      nativePrivacyServiceSettings: ReturnType<
        typeof createPrivacyServiceSettings
      >;
    },
  };
  const path = new NodeURL(
    '../src/platform/privacyServiceSettings.native.ts',
    import.meta.url
  );
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require(name: string) {
      if (name === 'expo-secure-store') return secureStore;
      assert.equal(name, '../../../../source/shared/privacyServiceOrigin.ts');
      return { createPrivacyServiceSettings };
    },
  });
  const settings = module.exports.nativePrivacyServiceSettings;
  assert.equal(await settings.getOrigin(), DEFAULT_PRIVACY_SERVICE_ORIGIN);
  await settings.changeOrigin('https://native.example', async () => undefined);
  assert.equal((await settings.capture()).origin, 'https://native.example');
  for (const { key, options } of calls) {
    assert.equal(key, PRIVACY_SERVICE_ORIGIN_STORAGE_KEY);
    assert.equal(
      options.keychainService,
      'org.pali.mobile.privacy-preferences'
    );
    assert.equal(options.keychainAccessible, 'device-only');
    assert.equal(options.requireAuthentication, false);
    assert.equal(Object.isFrozen(options), true);
  }
  available = false;
  const count = calls.length;
  await assert.rejects(
    settings.getOrigin(),
    /privacy_service_storage_unavailable/
  );
  await assert.rejects(
    settings.changeOrigin('https://other.example', async () => undefined),
    /privacy_service_storage_unavailable/
  );
  assert.equal(calls.length, count);
  assert.equal(saved, 'https://native.example');
});
