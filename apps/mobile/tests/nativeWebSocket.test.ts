import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import ts from 'typescript';
import {
  createNativeWebSocket,
  NATIVE_SOCKET_MAX_BYTES,
  type NativeSocketEvent,
  type NativeSocketPort,
  type NativeBinaryBlobs,
} from '../modules/pali-walletconnect-socket/socket.ts';

function fixture(binary?: NativeBinaryBlobs) {
  const calls: unknown[][] = [];
  let sequence = 0;
  let listener!: (event: NativeSocketEvent) => void;
  const port: NativeSocketPort = {
    createId: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    connect: (...args) => {
      calls.push(['connect', ...args]);
    },
    send: (...args) => {
      calls.push(['send', ...args]);
      return true;
    },
    close: (...args) => {
      calls.push(['close', ...args]);
    },
    bufferedAmount: () => 0,
    addListener(_name, next) {
      listener = next;
      return { remove() {} };
    },
  };
  const BlobType = Blob;
  const Socket = createNativeWebSocket(
    port,
    binary ?? {
      create: (bytes) => new BlobType([bytes]),
      isBlob: (value): value is Blob => value instanceof BlobType,
      read: (value) => BlobType.prototype.arrayBuffer.call(value),
    }
  );
  return {
    Socket,
    calls,
    event(
      type: NativeSocketEvent['type'],
      data: Partial<NativeSocketEvent> = {}
    ) {
      listener({
        id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        type,
        ...data,
      });
    },
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('connecting close requests native cancellation and ignores late open', () => {
  const f = fixture(),
    socket = new f.Socket('wss://relay.example/');
  let opened = 0,
    closed = 0;
  socket.onopen = () => {
    opened++;
  };
  socket.onclose = () => {
    closed++;
  };
  socket.close();
  assert.equal(socket.readyState, socket.CLOSING);
  assert.equal(f.calls.filter(([type]) => type === 'close').length, 1);
  f.event('open');
  assert.equal(opened, 0);
  f.event('error');
  f.event('close', { code: 1000 });
  assert.equal(socket.readyState, socket.CLOSED);
  assert.equal(closed, 1);
});

test('text, captured binary and Blob sends retain FIFO before normal close', async () => {
  const f = fixture(),
    socket = new f.Socket('wss://relay.example/');
  f.event('open');
  const bytes = new Uint8Array([1, 2]);
  socket.send(new Blob([new Uint8Array([3])]));
  socket.send(bytes);
  bytes[0] = 9;
  socket.send('last');
  socket.close(3000, 'done');
  assert.equal(f.calls.length, 1);
  await flush();
  assert.deepEqual(
    f.calls.slice(1).map((call) => call.slice(0, 1).concat(call.slice(2))),
    [
      ['send', 'Aw==', true],
      ['send', 'AQI=', true],
      ['send', 'last', false],
      ['close', 3000, 'done'],
    ]
  );
});

test('binary events respect arraybuffer or Blob delivery and close is terminal', async () => {
  const f = fixture(),
    socket = new f.Socket('wss://relay.example/');
  f.event('open');
  const received: unknown[] = [];
  socket.onmessage = (event) => {
    received.push(event.data);
  };
  f.event('binary', { data: 'AQI=' });
  assert(received[0] instanceof Blob);
  socket.binaryType = 'arraybuffer';
  f.event('binary', { data: 'AwQ=' });
  assert.deepEqual(
    new Uint8Array(received[1] as ArrayBuffer),
    new Uint8Array([3, 4])
  );
  f.event('close', { code: 1000, reason: 'done' });
  f.event('text', { data: 'late' });
  assert.equal(received.length, 2);
});

test('validates protocols, endpoint, UTF-8 close reason and frame bounds', () => {
  const f = fixture();
  assert.throws(() => new f.Socket('https://relay.example/'));
  assert.throws(() => new f.Socket('wss://user:secret@relay.example/'));
  assert.throws(() => new f.Socket('wss://relay.example/', ['same', 'same']));
  const socket = new f.Socket('wss://relay.example/', ['wc']);
  assert.throws(() => socket.send('before open'));
  assert.throws(() => socket.close(1001));
  assert.throws(() => socket.close(1000, 'é'.repeat(62)));
  f.event('open', { protocol: 'wc' });
  assert.equal(socket.protocol, 'wc');
  assert.throws(() => socket.send('a'.repeat(NATIVE_SOCKET_MAX_BYTES + 1)));
  assert.throws(() => socket.send('é'.repeat(NATIVE_SOCKET_MAX_BYTES)));
});

test('unknown socket identifiers cannot publish into a live connection', () => {
  const f = fixture(),
    socket = new f.Socket('wss://relay.example/');
  f.event('open', { id: 'old-id' });
  assert.equal(socket.readyState, socket.CONNECTING);
  f.event('open');
  assert.equal(socket.readyState, socket.OPEN);
});

test('event handler identity, replacement and once listeners follow EventTarget', () => {
  const f = fixture(),
    socket = new f.Socket('wss://relay.example/');
  let old = 0,
    current = 0,
    once = 0;
  socket.onopen = () => {
    old++;
  };
  const callback = function (this: WebSocket) {
    assert.equal(this, socket);
    current++;
  };
  socket.onopen = callback;
  assert.equal(socket.onopen, callback);
  socket.addEventListener(
    'message',
    () => {
      once++;
    },
    { once: true }
  );
  f.event('open');
  f.event('text', { data: 'one' });
  f.event('text', { data: 'two' });
  assert.equal(old, 0);
  assert.equal(current, 1);
  assert.equal(once, 1);
  assert.equal(Reflect.set(socket, 'readyState', socket.CLOSED), false);
  assert.equal(Reflect.set(socket, 'protocol', 'changed'), false);
});

test('a terminal event discards a delayed Blob before it reaches the native send', async () => {
  const f = fixture(),
    socket = new f.Socket('wss://relay.example/');
  f.event('open');
  socket.send(new Blob(['a']));
  f.event('error');
  await flush();
  assert.equal(f.calls.filter(([kind]) => kind === 'send').length, 0);
  assert.equal(socket.bufferedAmount, 0);
});

test('a Blob read must match its admitted byte length before encoding', async () => {
  const f = fixture({
    create: (bytes) => new Blob([bytes]),
    isBlob: (value): value is Blob => value instanceof Blob,
    read: async () => new ArrayBuffer(NATIVE_SOCKET_MAX_BYTES + 1),
  });
  const socket = new f.Socket('wss://relay.example/');
  f.event('open');
  socket.send(new Blob(['small']));
  await flush();
  assert.equal(f.calls.filter(([kind]) => kind === 'send').length, 0);
  assert.equal(f.calls.filter(([kind]) => kind === 'close').length, 1);
  assert.equal(socket.bufferedAmount, 0);
});

test('message delivery works without a global MessageEvent constructor', () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'MessageEvent'
  );
  Object.defineProperty(globalThis, 'MessageEvent', {
    configurable: true,
    value: undefined,
  });
  try {
    const f = fixture(),
      socket = new f.Socket('wss://relay.example/');
    let received: unknown;
    socket.onmessage = (event) => {
      received = event.data;
    };
    f.event('open');
    f.event('text', { data: 'payload' });
    assert.equal(received, 'payload');
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, 'MessageEvent', descriptor);
    else Reflect.deleteProperty(globalThis, 'MessageEvent');
  }
});

test('oversized binary input is refused before a buffer copy', () => {
  const f = fixture(),
    socket = new f.Socket('wss://relay.example/');
  f.event('open');
  const original = Uint8Array.prototype.slice;
  let copies = 0;
  // Instrument copying only for this allocation-boundary regression.
  // eslint-disable-next-line no-extend-native
  Uint8Array.prototype.slice = function (start, end) {
    copies++;
    return original.call(this, start, end);
  };
  try {
    const oversized = new ArrayBuffer(NATIVE_SOCKET_MAX_BYTES + 1);
    assert.throws(() => socket.send(oversized));
    assert.throws(() => socket.send(new DataView(oversized)));
    assert.equal(copies, 0);
  } finally {
    // eslint-disable-next-line no-extend-native
    Uint8Array.prototype.slice = original;
  }
});

test('Expo Blob delivery and legacy Blob sends work when the RN Blob rejects typed arrays', async () => {
  const OriginalBlob = Blob;
  class ReactNativeBlob extends OriginalBlob {
    constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
      if (
        parts.some(
          (part) => part instanceof ArrayBuffer || ArrayBuffer.isView(part)
        )
      )
        throw new Error('RN Blob does not accept binary parts');
      super(parts, options);
    }
  }
  // Execute the pinned public Expo wrapper with a native byte-store stand-in.
  // This checks its JS API and the adapter, without claiming Android execution.
  class NativeBlob extends OriginalBlob {
    async bytes() {
      return new Uint8Array(
        await OriginalBlob.prototype.arrayBuffer.call(this)
      );
    }
  }
  const load = (name: string, dependencies: Record<string, unknown>) => {
    const source = readFileSync(
      new NodeURL(`../node_modules/expo-blob/src/${name}.ts`, import.meta.url),
      'utf8'
    );
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const module = { exports: {} as Record<string, unknown> };
    const require = (id: string) => {
      assert(
        Object.hasOwn(dependencies, id),
        `Unexpected Expo dependency ${id}`
      );
      return dependencies[id];
    };
    new Function('require', 'module', 'exports', output)(
      require,
      module,
      module.exports
    );
    return module.exports;
  };
  const utils = load('utils', {});
  const ExpoBlob = load('ExpoBlob', {
    expo: { requireNativeModule: () => ({ Blob: NativeBlob }) },
    './utils': utils,
  }).Blob as typeof NativeBlob;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Blob')!;
  Object.defineProperty(globalThis, 'Blob', {
    ...descriptor,
    value: ReactNativeBlob,
  });
  try {
    assert.throws(() => new Blob([new Uint8Array([1])]));
    const f = fixture({
      create: (bytes) => new ExpoBlob([bytes]),
      isBlob: (value): value is Blob => value instanceof ExpoBlob,
      read: (value) => ExpoBlob.prototype.arrayBuffer.call(value),
    });
    const socket = new f.Socket('wss://relay.example/');
    const received: Blob[] = [];
    socket.onmessage = (event) => {
      received.push(event.data);
    };
    f.event('open');
    f.event('binary', { data: 'YWJj' });
    const result = received[0]!;
    assert(result instanceof ExpoBlob);
    assert.equal(globalThis.Blob, ReactNativeBlob);
    assert.equal(result.size, 3);
    assert.equal(result.type, '');
    assert.equal(await result.text(), 'abc');
    assert.deepEqual(
      new Uint8Array(await result.arrayBuffer()),
      new Uint8Array([97, 98, 99])
    );
    const slice = result.slice(1, 3, 'TEXT/PLAIN');
    assert.equal(slice.type, 'text/plain');
    assert.equal(await slice.text(), 'bc');
    socket.send(result);
    socket.send(new ReactNativeBlob(['legacy']));
    socket.send(new Uint8Array([9, 8, 7]).subarray(1, 2));
    assert.throws(() =>
      socket.send({
        size: 1,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      } as Blob)
    );
    socket.close();
    await flush();
    assert.deepEqual(
      f.calls.filter(([kind]) => kind === 'send').map((call) => call.slice(2)),
      [
        ['YWJj', true],
        ['bGVnYWN5', true],
        ['CA==', true],
      ]
    );
  } finally {
    Object.defineProperty(globalThis, 'Blob', descriptor);
  }
});
