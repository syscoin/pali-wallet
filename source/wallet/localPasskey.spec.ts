import {
  createLocalPasskeyResponseFixture,
  localPasskeyTestCrypto as crypto,
} from '../../tests/helpers/localPasskeyResponse';

import { createLocalPasskeyBroker } from './localPasskeyBroker';
import {
  createLocalPasskeyCredentialPort,
  type LocalPasskeyRecord,
} from './localPasskeyCredential';
import {
  captureLocalPasskeyResponse,
  localPasskeyBase64 as b64,
  localPasskeyBytes,
} from './localPasskeyTypes';

Object.defineProperty(globalThis, 'crypto', {
  value: crypto,
  configurable: true,
});
const origin = `chrome-extension://${'a'.repeat(32)}`;
const scope = {
  installationId: 'installation-1',
  walletBindingId: 'wallet-1',
  enrollmentId: 'a'.repeat(32),
  pairFingerprint: 'b'.repeat(64),
};
const check = () => undefined;
async function fixture() {
  const responses = await createLocalPasskeyResponseFixture(origin);
  let stored: LocalPasskeyRecord | undefined;
  const port = createLocalPasskeyCredentialPort({
    origin,
    crypto,
    ceremonies: { request: responses.respond },
    storage: {
      async read() {
        return stored;
      },
      async stage(_scope, record) {
        stored = structuredClone(record);
      },
      async remove() {
        stored = undefined;
      },
    },
  });
  return {
    port,
    respond: responses.respond,
    get stored() {
      return stored;
    },
    get requests() {
      return responses.requests;
    },
    tamperPrf: responses.tamperPrf,
    tamperSignature: responses.tamperSignature,
  };
}

test('requires registration and a signed PRF assertion, then unwraps the SDK key with the same credential', async () => {
  const f = await fixture(),
    key = new Uint8Array(32).fill(6);
  const originalKey = new Uint8Array(key);
  const pending = f.port.stage(scope, key, check);
  key.fill(0);
  await pending;
  expect(f.requests).toBe(2);
  expect(f.stored?.envelope).toMatch(/^v1:/);
  expect(JSON.stringify(f.stored)).not.toContain(b64(originalKey));
  const unlocked = await f.port.read(scope, check);
  expect(unlocked).toEqual(originalKey);
  expect(f.requests).toBe(3);
  unlocked?.fill(0);
});
test('wrong PRF cannot unwrap, even with a valid assertion', async () => {
  const f = await fixture();
  await f.port.stage(scope, new Uint8Array(32).fill(6), check);
  f.tamperPrf();
  await expect(f.port.read(scope, check)).rejects.toThrow();
});
test('bad signatures and replay under another wallet scope are refused', async () => {
  const f = await fixture();
  await f.port.stage(scope, new Uint8Array(32).fill(6), check);
  f.tamperSignature();
  await expect(f.port.read(scope, check)).rejects.toThrow();
  await expect(
    f.port.read({ ...scope, pairFingerprint: 'c'.repeat(64) }, check)
  ).rejects.toThrow();
});
test('absent PRF, accessors and noncanonical bytes are rejected by transport capture', () => {
  const fields = {
    kind: 'get',
    rawId: 'AQ',
    clientDataJSON: 'AQ',
    authenticatorData: b64(new Uint8Array(37)),
    signature: 'AQ',
  };
  expect(() => captureLocalPasskeyResponse(fields)).toThrow();
  expect(() =>
    captureLocalPasskeyResponse({
      ...fields,
      prfOutput: b64(new Uint8Array(32)),
      get extra() {
        throw Error('must not run');
      },
    })
  ).toThrow();
  expect(() => localPasskeyBytes('AR', 1)).toThrow();
});
test('cancellation prevents an otherwise valid enrollment from being stored', async () => {
  const f = await fixture();
  let live = true;
  await expect(
    f.port.stage(scope, new Uint8Array(32), () => {
      if (!live) throw Error('cancelled');
      live = false;
    })
  ).rejects.toThrow();
  expect(f.stored).toBeUndefined();
});

function brokerFixture() {
  let now = 1000,
    id = 0;
  const timers: (() => void)[] = [];
  const broker = createLocalPasskeyBroker({
    now: () => now,
    wallTime: () => 100000,
    randomId: () => (++id).toString(16).padStart(32, '0'),
    setTimer: ((callback: () => void) => {
      timers.push(callback);
      return id;
    }) as typeof setTimeout,
    clearTimer: () => undefined,
  });
  return {
    broker,
    advance() {
      now += 90000;
    },
    timers,
  };
}
test('broker requires exact ceremony identity and stale replies cannot cancel its next prompt', async () => {
  const f = brokerFixture(),
    responseFixture = await fixture();
  const first = await f.broker.begin(async (transport, guard) => {
    const request = {
      kind: 'create' as const,
      challenge: b64(new Uint8Array(32)),
      origin,
      prfSalt: b64(new Uint8Array(32)),
      userHandle: b64(new Uint8Array(32)),
    };
    await transport.request(request, guard);
    await transport.request(
      { ...request, kind: 'get', credentialId: 'Bw' },
      guard
    );
    return true;
  }, check);
  if (first.kind === 'complete') throw Error('expected prompt');
  const second = await f.broker.complete(
    first.operationId,
    first.ceremonyId,
    await responseFixture.respond(first)
  );
  if (second.kind === 'complete') throw Error('expected second prompt');
  await expect(
    f.broker.complete(
      first.operationId,
      first.ceremonyId,
      await responseFixture.respond(first)
    )
  ).rejects.toThrow();
  const done = await f.broker.complete(
    second.operationId,
    second.ceremonyId,
    await responseFixture.respond(second)
  );
  expect(done.kind).toBe('complete');
});
test('broker checks the exact deadline even when its timer has not fired', async () => {
  const f = brokerFixture();
  let accepted = 0;
  const first = await f.broker.begin(async (transport, guard) => {
    await transport.request(
      {
        kind: 'get',
        origin,
        challenge: b64(new Uint8Array(32)),
        prfSalt: b64(new Uint8Array(32)),
        credentialId: 'Bw',
      },
      guard
    );
    accepted++;
    return true;
  }, check);
  if (first.kind === 'complete') throw Error('expected prompt');
  f.advance();
  await expect(
    f.broker.complete(first.operationId, first.ceremonyId, {} as never)
  ).rejects.toThrow();
  await f.broker.cancel(first.operationId);
  expect(accepted).toBe(0);
});
test('cancel drains admitted work and an old cancel never retires a successor', async () => {
  const f = brokerFixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const starting = f.broker.begin(async (_transport, guard) => {
    await held;
    guard();
    return true;
  }, check);
  starting.catch(() => undefined);
  await expect(f.broker.begin(async () => true, check)).rejects.toThrow();
  release();
  const done = await starting;
  expect(done.kind).toBe('complete');
  await Promise.resolve();
  await Promise.resolve();
  await f.broker.cancel('f'.repeat(32));
  expect((await f.broker.begin(async () => true, check)).kind).toBe('complete');
});

test('cancel without an id retires the bound operation before its first prompt', async () => {
  const f = brokerFixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const starting = f.broker.begin(async (_transport, guard) => {
    await held;
    guard();
    return true;
  }, check);
  const rejected = expect(starting).rejects.toThrow();
  const cancelling = f.broker.cancel();
  release();
  await cancelling;
  await rejected;
  expect((await f.broker.begin(async () => true, check)).kind).toBe('complete');
});
