import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as pairingLinks from '../src/connections/pairingLinks.ts';
import { parseEvmRecipientQr } from '../src/core/recipientQr.ts';

type Element = {
  type: unknown;
  props: Record<string, any>;
  children: unknown[];
};
type Cell = {
  value?: unknown;
  dependencies?: readonly unknown[];
  cleanup?: () => void;
};
const URI = `wc:${'11'.repeat(32)}@2?relay-protocol=irn&symKey=${'22'.repeat(
  32
)}`;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const code = ts.transpileModule(
  readFileSync(
    new URL('../src/screens/QrScanner.native.tsx', import.meta.url),
    'utf8'
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }
).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(
  permission: () => Promise<{ granted: boolean }>,
  platform = 'android',
  kind: 'connection' | 'recipient' = 'connection'
) {
  const cells: Cell[] = [];
  const effects: (() => void)[] = [];
  const listeners = new Map<string, Set<(value?: string) => unknown>>();
  const scans: string[] = [];
  let cursor = 0,
    closes = 0,
    permissionRequests = 0,
    stateWrites = 0;
  let settings: () => Promise<void> = async () => undefined;
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    Fragment: 'Fragment',
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) {
      const state = cell();
      if (!Object.hasOwn(state, 'value'))
        state.value = typeof initial === 'function' ? initial() : initial;
      return [
        state.value,
        (value: unknown) => {
          stateWrites++;
          state.value = typeof value === 'function' ? value(state.value) : value;
        },
      ];
    },
    useRef(value: unknown) {
      const ref = cell();
      ref.value ??= { current: value };
      return ref.value;
    },
    useEffect(
      effect: () => void | (() => void),
      dependencies: readonly unknown[]
    ) {
      const state = cell();
      if (
        state.dependencies &&
        dependencies.every((value, index) =>
          Object.is(value, state.dependencies![index])
        )
      )
        return;
      state.dependencies = dependencies;
      effects.push(() => {
        state.cleanup?.();
        state.cleanup = effect() || undefined;
      });
    },
  };
  const listen = (name: string, listener: (value?: string) => unknown) => {
    const group = listeners.get(name) ?? new Set();
    group.add(listener);
    listeners.set(name, group);
    return { remove: () => group.delete(listener) };
  };
  const appState = { currentState: 'active', addEventListener: listen };
  const dependencies: Record<string, unknown> = {
    react,
    'react-native': {
      AppState: appState,
      BackHandler: { addEventListener: listen },
      Linking: { openSettings: () => settings() },
      Platform: { OS: platform },
      StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
      ActivityIndicator: 'ActivityIndicator',
      View: 'View',
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-camera': {
      CameraView: 'CameraView',
      Camera: {
        requestCameraPermissionsAsync() {
          permissionRequests++;
          return permission();
        },
        requestMicrophonePermissionsAsync() {
          assert.fail('QR scanning must not request microphone access');
        },
      },
    },
    '../connections/pairingLinks': pairingLinks,
    '../ui': {
      Button: 'Button',
      Header: 'Header',
      IconButton: 'IconButton',
      Notice: 'Notice',
      Screen: 'Screen',
      Text: 'Text',
      colors: {},
    },
  };
  const module = {
    exports: {} as { QrScanner(props: object): Element },
  };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(name: string) {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Unexpected scanner dependency ${name}`
      );
      return dependencies[name];
    },
  });
  const wrapper = { exports: {} as Record<string, (props: object) => Element> };
  const wrapperName = kind === 'connection' ? 'ConnectionQrScanner' : 'RecipientQrScanner';
  const wrapperCode = ts.transpileModule(readFileSync(new URL(`../src/screens/${kind === 'connection' ? 'ConnectionQrScanner.shared' : 'RecipientQrScanner'}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  runInNewContext(wrapperCode, { module: wrapper, exports: wrapper.exports, require(name: string) {
    if (name === './QrScanner') return { QrScanner: 'QrScanner' };
    if (name === '../core/recipientQr') return { parseEvmRecipientQr };
    assert(Object.hasOwn(dependencies, name), `Unexpected wrapper dependency ${name}`); return dependencies[name];
  } });
  const props = {
    onScan: (uri: string) => scans.push(uri),
    onClose: () => {
      closes++;
    },
  };
  const render = () => {
    cursor = 0;
    const tree = module.exports.QrScanner(wrapper.exports[wrapperName]!(props).props);
    effects.splice(0).forEach((effect) => effect());
    return tree;
  };
  render();
  return {
    scans,
    render,
    get closes() {
      return closes;
    },
    get permissionRequests() {
      return permissionRequests;
    },
    get stateWrites() {
      return stateWrites;
    },
    emit(name: string, value?: string) {
      if (name === 'change') appState.currentState = value!;
      for (const listener of listeners.get(name) ?? []) listener(value);
    },
    settingsFail() {
      settings = async () => {
        throw new Error('Settings unavailable');
      };
    },
    unmount() {
      cells.forEach((state) => state.cleanup?.());
    },
    listenerCount() {
      return [...listeners.values()].reduce(
        (total, group) => total + group.size,
        0
      );
    },
  };
}

function elements(value: unknown): Element[] {
  if (!value || typeof value !== 'object' || !('type' in value)) return [];
  const element = value as Element;
  return [element, ...element.children.flat(Infinity).flatMap(elements)];
}
const find = (tree: Element, type: string) =>
  elements(tree).find((element) => element.type === type);
const notice = (tree: Element, title: string) =>
  elements(tree).some(
    (element) => element.type === 'Notice' && element.props.title === title
  );

test('flashlight is explicit, waits for the camera and resets after focus loss', async () => {
  const f = fixture(async () => ({ granted: true }));
  try {
    await settle();
    let tree = f.render();
    assert.equal(elements(tree).some(node => node.props.title === 'Turn on flashlight'), false);
    find(tree, 'CameraView')!.props.onCameraReady();
    tree = f.render();
    elements(tree).find(node => node.props.title === 'Turn on flashlight')!.props.onPress();
    assert.equal(find(f.render(), 'CameraView')!.props.enableTorch, true);
    f.emit('blur');
    assert.equal(find(f.render(), 'CameraView'), undefined);
    f.emit('focus');
    assert.equal(find(f.render(), 'CameraView')!.props.enableTorch, false);
  } finally { f.unmount(); }
});

test('denied camera permission offers Settings and failed permission requests show an error without mounting a camera', async () => {
  const denied = fixture(async () => ({ granted: false }));
  try {
    await settle();
    let tree = denied.render();
    assert(notice(tree, 'Camera access needed'));
    assert.equal(find(tree, 'CameraView'), undefined);
    denied.settingsFail();
    elements(tree)
      .find(
        (element) =>
          element.type === 'Button' && element.props.title === 'Open Settings'
      )!
      .props.onPress();
    await settle();
    tree = denied.render();
    assert(notice(tree, 'Camera unavailable'));
    assert.equal(denied.permissionRequests, 1);
  } finally {
    denied.unmount();
  }
  const failed = fixture(async () => {
    throw new Error('Camera bridge unavailable');
  });
  try {
    await settle();
    assert(notice(failed.render(), 'Camera unavailable'));
    assert.equal(find(failed.render(), 'CameraView'), undefined);
    assert.deepEqual(failed.scans, []);
  } finally {
    failed.unmount();
  }
});

test('the camera accepts only QR input and hands one valid connection to the controller', async () => {
  const f = fixture(async () => ({ granted: true }));
  try {
    await settle();
    const camera = find(f.render(), 'CameraView')!;
    assert(camera);
    assert.deepEqual(
      Array.from(camera.props.barcodeScannerSettings.barcodeTypes),
      ['qr']
    );
    assert.equal(camera.props.facing, 'back');
    assert.equal(camera.props.active, true);
    assert.equal(camera.props.mode, undefined);
    assert.equal(camera.props.onPictureSaved, undefined);
    camera.props.onBarcodeScanned({ data: 'https://unrelated.example' });
    assert.deepEqual(f.scans, []);
    assert(notice(f.render(), 'Connection code needed'));
    camera.props.onBarcodeScanned({ data: URI });
    camera.props.onBarcodeScanned({ data: URI });
    assert.deepEqual(f.scans, [URI]);
  } finally {
    f.unmount();
  }
});

test('recipient QR accepts only a validated raw address and never consumes a payment or connection link', async () => {
  const f = fixture(async () => ({ granted: true }), 'android', 'recipient');
  try {
    await settle(); const camera = find(f.render(), 'CameraView')!;
    const address = '0x52908400098527886E0F7030069857D2E4169EE7';
    for (const value of [URI, `ethereum:${address}?value=100`, ` ${address}`, '0x' + '0'.repeat(40), address.slice(0, -1)])
      camera.props.onBarcodeScanned({ data: value });
    assert.deepEqual(f.scans, []); assert(notice(f.render(), 'Recipient address needed'));
    camera.props.onBarcodeScanned({ data: address.toLowerCase() });
    camera.props.onBarcodeScanned({ data: address });
    assert.deepEqual(f.scans, [address]);
  } finally { f.unmount(); }
});

test('a recipient scan is retired by Back before a queued camera result', async () => {
  const f = fixture(async () => ({ granted: true }), 'android', 'recipient');
  try {
    await settle(); const scan = find(f.render(), 'CameraView')!.props.onBarcodeScanned;
    f.emit('hardwareBackPress'); scan({ data: '0x1111111111111111111111111111111111111111' });
    assert.equal(f.closes, 1); assert.deepEqual(f.scans, []);
  } finally { f.unmount(); }
});

for (const boundary of ['background', 'blur', 'unmount'] as const) {
  test(`a queued scan cannot cross ${boundary}`, async () => {
    const f = fixture(async () => ({ granted: true }));
    await settle();
    const scan = find(f.render(), 'CameraView')!.props.onBarcodeScanned;
    try {
      if (boundary === 'background') f.emit('change', 'background');
      else if (boundary === 'blur') f.emit('blur');
      else f.unmount();
      scan({ data: URI });
      assert.deepEqual(f.scans, []);
      if (boundary !== 'unmount')
        assert.equal(find(f.render(), 'CameraView'), undefined);
      else assert.equal(f.listenerCount(), 0);
    } finally {
      f.unmount();
    }
  });
}

test('Android focus resumes QR scanning after a notification-shade blur', async () => {
  const f = fixture(async () => ({ granted: true }));
  try {
    await settle();
    f.emit('blur');
    assert.equal(find(f.render(), 'CameraView'), undefined);
    f.emit('focus');
    const camera = find(f.render(), 'CameraView');
    assert(camera);
    camera.props.onBarcodeScanned({ data: URI });
    assert.deepEqual(f.scans, [URI]);
  } finally {
    f.unmount();
  }
});

test('a camera mount failure disables a queued scan before the error rerenders', async () => {
  const f = fixture(async () => ({ granted: true }));
  try {
    await settle();
    const camera = find(f.render(), 'CameraView')!;
    camera.props.onMountError();
    camera.props.onBarcodeScanned({ data: URI });
    assert.deepEqual(f.scans, []);
    assert(notice(f.render(), 'Camera unavailable'));
    assert.equal(find(f.render(), 'CameraView'), undefined);
  } finally {
    f.unmount();
  }
});

test('a delayed permission response after Close cannot publish camera state or a scan', async () => {
  const permission = deferred<{ granted: boolean }>();
  const f = fixture(() => permission.promise);
  await settle();
  find(f.render(), 'Header')!.props.right.props.onPress();
  const writes = f.stateWrites;
  permission.resolve({ granted: true });
  await settle();
  assert.equal(f.stateWrites, writes);
  assert.equal(f.closes, 1);
  assert.equal(find(f.render(), 'CameraView'), undefined);
  assert.deepEqual(f.scans, []);
  f.unmount();
});

test('a delayed permission response after unmount cannot update the scanner', async () => {
  const permission = deferred<{ granted: boolean }>();
  const f = fixture(() => permission.promise);
  await settle();
  f.unmount();
  const writes = f.stateWrites;
  permission.resolve({ granted: true });
  await settle();
  assert.equal(f.stateWrites, writes);
  assert.equal(f.listenerCount(), 0);
  assert.deepEqual(f.scans, []);
});

for (const boundary of ['close', 'unmount'] as const) {
  test(`camera permission is not requested after ${boundary} before the scheduled call`, async () => {
    const f = fixture(async () => ({ granted: true }));
    if (boundary === 'close') find(f.render(), 'Header')!.props.right.props.onPress();
    else f.unmount();
    await settle();
    assert.equal(f.permissionRequests, 0);
    assert.equal(find(f.render(), 'CameraView'), undefined);
    assert.deepEqual(f.scans, []);
    f.unmount();
  });
}

test('Android Back closes the scanner and suppresses a retained scan callback', async () => {
  const f = fixture(async () => ({ granted: true }));
  try {
    await settle();
    const scan = find(f.render(), 'CameraView')!.props.onBarcodeScanned;
    f.emit('hardwareBackPress');
    scan({ data: URI });
    assert.equal(f.closes, 1);
    assert.deepEqual(f.scans, []);
  } finally {
    f.unmount();
  }
});

test('camera configuration permits QR scanning and blocks microphone recording', () => {
  const { expo } = JSON.parse(
    readFileSync(new URL('../app.json', import.meta.url), 'utf8')
  );
  const camera = expo.plugins.find(
    (entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-camera'
  )[1];
  assert.equal(camera.barcodeScannerEnabled, true);
  assert.equal(camera.microphonePermission, false);
  assert.equal(camera.recordAudioAndroid, false);
  assert(
    expo.android.blockedPermissions.includes('android.permission.RECORD_AUDIO')
  );
  assert.equal(
    expo.android.blockedPermissions.includes('android.permission.CAMERA'),
    false
  );
});
