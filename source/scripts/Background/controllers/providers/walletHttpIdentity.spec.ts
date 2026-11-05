import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { runInNewContext } from 'vm';

import { PALI_HTTP_USER_AGENT } from '../../../../shared/paliHttpIdentity';

import { createPaliFetch } from './patchFetchWithPaliHeaders';
import { createWalletHttpIdentity } from './walletHttpIdentity';

function fixture(limit = 5000) {
  let rules: any[] = [{ id: 7, action: {}, condition: {} }];
  let failed = false;
  const store = {
    MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: limit,
    MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
    getDynamicRules: jest.fn(async () => rules),
    updateDynamicRules: jest.fn(async ({ removeRuleIds, addRules }) => {
      if (failed) throw Error('rule installation failed');
      rules = [
        ...rules.filter((rule) => !removeRuleIds.includes(rule.id)),
        ...addRules,
      ];
    }),
  };
  const identity = createWalletHttpIdentity('a'.repeat(32), store);
  return {
    identity,
    store,
    rules: () => rules,
    fail() {
      failed = true;
    },
    recover() {
      failed = false;
    },
  };
}

test('rules cover only owned XHR to exact configured origins and never store path secrets', async () => {
  const f = fixture();
  await f.identity.configure([
    'https://rpc.example:443/api/private-key?apikey=private',
    'https://rpc.example/another',
  ]);
  expect(f.rules().length).toBe(2);
  const rule = f.rules()[1];
  expect(rule.condition).toEqual({
    initiatorDomains: ['a'.repeat(32)],
    resourceTypes: ['xmlhttprequest'],
    urlFilter: '|https://rpc.example/',
  });
  expect(
    'https://rpc.example.attacker.test/'.startsWith(
      rule.condition.urlFilter.slice(1)
    )
  ).toBe(false);
  expect(JSON.stringify(rule)).not.toContain('private');
  expect(rule.action.requestHeaders).toEqual([
    { header: 'user-agent', operation: 'set', value: PALI_HTTP_USER_AGENT },
  ]);
  await f.identity.configure([]);
  expect(f.rules().map((r) => r.id)).toEqual([7]);
});

test('failed installation prevents requests and an acknowledged result survives cleanup failure', async () => {
  const f = fixture();
  f.fail();
  await expect(f.identity.configure(['https://rpc.example'])).rejects.toThrow(
    'rule installation failed'
  );
  await expect(f.identity.prepare('https://rpc.example/a')).rejects.toThrow(
    'rule installation failed'
  );
  const g = fixture();
  await g.identity.configure([]);
  const result = await g.identity.withBackend(
    'https://candidate.example',
    async () => {
      g.fail();
      return 'acknowledged-hash';
    }
  );
  expect(result).toBe('acknowledged-hash');
  await expect(g.identity.prepare('https://unrelated.example')).resolves.toBe(
    false
  );
});

test('concurrent temporary users retain the origin until both finish', async () => {
  const f = fixture();
  await f.identity.configure([]);
  let done!: () => void;
  const held = new Promise<void>((resolve) => {
    done = resolve;
  });
  const first = f.identity.withBackend('https://rpc.example/path', async () => {
    await held;
  });
  await f.identity.withBackend('https://rpc.example/path', async () => {
    expect(await f.identity.prepare('https://rpc.example/another')).toBe(true);
  });
  expect(await f.identity.prepare('https://rpc.example')).toBe(true);
  done();
  await first;
  await Promise.resolve();
  expect(await f.identity.prepare('https://rpc.example')).toBe(false);
});

for (const shape of ['object', 'headers', 'tuples', 'request'] as const) {
  test(`wallet ${shape} request retains authorization, body, signal and original headers`, async () => {
    const f = fixture();
    await f.identity.configure(['https://rpc.example']);
    const calls: any[] = [];
    const fetcher = createPaliFetch(async (input, init) => {
      calls.push({ input, init });
      return new Response('ok');
    }, f.identity);
    const signal = new AbortController().signal;
    const headerObject = {
      Authorization: 'Bearer public-fixture',
      'Content-Type': 'application/json',
    };
    const headers =
      shape === 'headers'
        ? new Headers(headerObject)
        : shape === 'tuples'
        ? Object.entries(headerObject)
        : headerObject;
    const body =
      '[{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}]';
    const init = { method: 'POST', headers, body, signal };
    if (shape === 'request')
      await fetcher(new Request('https://rpc.example/path', init));
    else await fetcher('https://rpc.example/path', init);
    const sent = new Request(calls[0].input, calls[0].init);
    expect(sent.headers.get('authorization')).toBe('Bearer public-fixture');
    expect(sent.headers.get('user-agent')).toBe(PALI_HTTP_USER_AGENT);
    expect(await sent.text()).toBe(body);
    expect(signal.aborted).toBe(false);
    expect(new Headers(headers).has('user-agent')).toBe(false);
    expect(calls.length).toBe(1);
  });
}

test('unrelated requests retain their exact inputs; transport failure and abort never retry', async () => {
  const f = fixture();
  await f.identity.configure(['https://rpc.example']);
  const failure = Error('network failure');
  const original = { method: 'GET' };
  const transport = jest.fn(async (...args: unknown[]) => {
    expect(args.length).toBe(2);
    throw failure;
  });
  const fetcher = createPaliFetch(transport, f.identity);
  await expect(fetcher('https://unrelated.example', original)).rejects.toBe(
    failure
  );
  expect(transport.mock.calls[0][1]).toBe(original);
  const controller = new AbortController();
  controller.abort();
  await expect(
    fetcher('https://rpc.example', { signal: controller.signal })
  ).rejects.toBe(controller.signal.reason);
  expect(transport).toHaveBeenCalledTimes(1);
});

test('rule installation await cannot change snapshotted method, header or body bytes', async () => {
  const f = fixture();
  const init = {
    method: 'POST',
    headers: new Headers({ Authorization: 'public-original' }),
    body: new Uint8Array([1, 2, 3]),
  };
  const calls: Request[] = [];
  const fetcher = createPaliFetch(async (input) => {
    calls.push(input as Request);
    return new Response('ok');
  }, f.identity);
  await f.identity.configure(['https://rpc.example']);
  const pending = fetcher('https://rpc.example/raw', init);
  init.method = 'DELETE';
  init.headers.set('Authorization', 'changed');
  init.body[0] = 255;
  await pending;
  expect(calls[0].method).toBe('POST');
  expect(calls[0].headers.get('Authorization')).toBe('public-original');
  expect([...new Uint8Array(await calls[0].arrayBuffer())]).toEqual([1, 2, 3]);
});

test('a POST never waits past its caller guard for pending rule installation', async () => {
  const f = fixture();
  const setup = f.identity.configure(['https://rpc.example']);
  const transport = jest.fn(async () => new Response('ok'));
  const fetcher = createPaliFetch(transport, f.identity);
  await expect(
    fetcher('https://rpc.example', { method: 'POST', body: '010203' })
  ).rejects.toThrow('identification is unavailable');
  expect(transport).not.toHaveBeenCalled();
  await setup;
  await fetcher('https://rpc.example', { method: 'POST', body: '010203' });
  expect(transport).toHaveBeenCalledTimes(1);
});

test('explicit null signal resets an incoming Request signal as standard fetch does', async () => {
  const f = fixture();
  await f.identity.configure(['https://rpc.example']);
  const controller = new AbortController();
  const original = new Request('https://rpc.example', {
    signal: controller.signal,
  });
  controller.abort();
  const transport = jest.fn(async (input) => {
    expect((input as Request).signal.aborted).toBe(false);
    return new Response('ok');
  });
  await createPaliFetch(transport, f.identity)(original, { signal: null });
  expect(transport).toHaveBeenCalledTimes(1);
});

test('identical normalized origins do not rewrite rules or interrupt ready POSTs', async () => {
  const f = fixture();
  await f.identity.configure(['https://rpc.example/a']);
  const calls = f.store.updateDynamicRules.mock.calls.length;
  const same = f.identity.configure([
    'https://rpc.example/b?public=1',
    'https://rpc.example:443/c',
  ]);
  expect(f.identity.isReady('https://rpc.example/transaction')).toBe(true);
  await same;
  expect(f.store.updateDynamicRules).toHaveBeenCalledTimes(calls);
});

test('aborting a GET during installation never starts its transport', async () => {
  const f = fixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.store.updateDynamicRules.mockImplementationOnce(async () => {
    await held;
  });
  const setup = f.identity.configure(['https://rpc.example']);
  const transport = jest.fn(async () => new Response('ok'));
  const controller = new AbortController();
  const pending = createPaliFetch(transport, f.identity)(
    'https://rpc.example',
    { signal: controller.signal }
  );
  controller.abort();
  release();
  await setup;
  await expect(pending).rejects.toBe(controller.signal.reason);
  expect(transport).not.toHaveBeenCalled();
});

test('1500 literal origins fit and leave unrelated rules unchanged', async () => {
  const f = fixture();
  const foreign = structuredClone(f.rules()[0]);
  const urls = Array.from(
    { length: 1500 },
    (_, n) => `https://rpc-${n}.public-fixture.invalid`
  );
  await f.identity.configure(urls);
  expect(f.rules()).toHaveLength(1501);
  expect(f.rules()[0]).toEqual(foreign);
  for (const rule of f.rules().slice(1)) {
    expect(rule.condition.urlFilter.startsWith('|https://')).toBe(true);
    expect(rule.condition.urlFilter.endsWith('/')).toBe(true);
    expect(rule.condition.regexFilter).toBeUndefined();
  }
});

test('actual unsafe quota includes retained foreign rules and refuses all HTTP without removing data', async () => {
  const f = fixture(3);
  const foreign = structuredClone(f.rules());
  const urls = Array.from(
    { length: 3 },
    (_, n) => `https://rpc-${n}.public-fixture.invalid`
  );
  await expect(f.identity.configure(urls)).rejects.toThrow('capacity');
  expect(f.store.updateDynamicRules).not.toHaveBeenCalled();
  expect(f.rules()).toEqual(foreign);
  const transport = jest.fn(async () => new Response('ok'));
  const fetcher = createPaliFetch(transport, f.identity);
  await expect(
    fetcher(urls[0], { method: 'POST', body: '010203' })
  ).rejects.toThrow('identification is unavailable');
  await expect(fetcher(urls[0])).rejects.toThrow('capacity');
  expect(transport).not.toHaveBeenCalled();
  await f.identity.configure(urls.slice(0, 2));
  expect(f.rules()).toHaveLength(3);
});

test('old combined browser quota accounts for dynamic and session rules', async () => {
  const store = {
    MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 3,
    getDynamicRules: jest.fn(
      async () => [{ id: 7, action: { type: 'block' }, condition: {} }] as any
    ),
    getSessionRules: jest.fn(
      async () => [{ id: 8, action: { type: 'block' }, condition: {} }] as any
    ),
    updateDynamicRules: jest.fn(async () => undefined),
  };
  const identity = createWalletHttpIdentity('a'.repeat(32), store);
  await expect(
    identity.configure(['https://one.invalid', 'https://two.invalid'])
  ).rejects.toThrow('capacity');
  expect(store.updateDynamicRules).not.toHaveBeenCalled();
  await identity.configure(['https://one.invalid']);
  expect(store.updateDynamicRules).toHaveBeenCalledTimes(1);
});

test('an explicit read probe coalesces one install retry and ordinary POST never retries', async () => {
  const f = fixture();
  f.fail();
  await expect(f.identity.configure(['https://rpc.example'])).rejects.toThrow(
    'rule installation failed'
  );
  const transport = jest.fn(async () => new Response('ok'));
  await expect(
    createPaliFetch(transport, f.identity)('https://rpc.example', {
      method: 'POST',
    })
  ).rejects.toThrow('identification is unavailable');
  expect(f.store.updateDynamicRules).toHaveBeenCalledTimes(1);
  f.recover();
  let ready!: () => void;
  const held = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const original = f.store.updateDynamicRules.getMockImplementation()!;
  f.store.updateDynamicRules.mockImplementationOnce(async (options) => {
    await held;
    return original(options);
  });
  const first = f.identity.withBackend(
    'https://rpc.example',
    async () => 'first-read'
  );
  const second = f.identity.withBackend(
    'https://rpc.example',
    async () => 'second-read'
  );
  ready();
  expect(await Promise.all([first, second])).toEqual([
    'first-read',
    'second-read',
  ]);
  expect(f.store.updateDynamicRules).toHaveBeenCalledTimes(2);
  expect(transport).not.toHaveBeenCalled();
  expect(f.identity.isReady('https://rpc.example')).toBe(true);
});

test('failed explicit retry preserves the error and performs no read', async () => {
  const f = fixture();
  f.fail();
  await expect(f.identity.configure(['https://rpc.example'])).rejects.toThrow(
    'rule installation failed'
  );
  const operation = jest.fn(async () => undefined);
  await expect(
    f.identity.withBackend('https://rpc.example', operation)
  ).rejects.toThrow('rule installation failed');
  expect(operation).not.toHaveBeenCalled();
  expect(f.store.updateDynamicRules).toHaveBeenCalledTimes(2);
});

test('missing browser HTTP capability keeps the adapter constructible but refuses identified traffic', async () => {
  const identity = createWalletHttpIdentity('', undefined);
  await expect(identity.configure(['https://rpc.example'])).rejects.toThrow(
    'identification is unavailable'
  );
  const transport = jest.fn(async () => new Response('ok'));
  const fetcher = createPaliFetch(transport, identity);
  await expect(fetcher('https://rpc.example')).rejects.toThrow(
    'identification is unavailable'
  );
  await expect(
    fetcher('https://rpc.example', { method: 'POST' })
  ).rejects.toThrow('identification is unavailable');
  expect(transport).not.toHaveBeenCalled();
});

test.each(['MV2', 'MV3'])(
  'actual %s manifest generator retains the least DNR permission',
  (kind) => {
    const source = readFileSync(
      resolvePath(__dirname, '../../../../config/generateManifest.js'),
      'utf8'
    );
    const templates = structuredClone(
      jest.requireActual('../../../../config/consts.js')
    );
    let generated: any;
    runInNewContext(source, {
      process: { env: { MANIFEST_TYPE: kind, NODE_ENV: 'production' } },
      require(name: string) {
        if (name === 'dotenv')
          return {
            config() {
              return undefined;
            },
          };
        if (name === 'fs')
          return {
            writeFileSync(_path: string, value: string) {
              generated = JSON.parse(value);
            },
          };
        if (name === '../../package.json') return { version: '4.0.121' };
        if (name === './consts.js') return templates;
        throw new Error('Unexpected manifest dependency');
      },
    });
    expect(generated.manifest_version).toBe(kind === 'MV2' ? 2 : 3);
    expect(generated.permissions).toContain(
      'declarativeNetRequestWithHostAccess'
    );
    expect(generated.permissions).not.toContain('declarativeNetRequest');
  }
);

for (const invalid of [
  'not a URL',
  'ftp://unsupported.public-fixture.invalid',
  'https://*.public-fixture.invalid',
]) {
  test(`mixed cold configuration refuses all recognized wallet HTTP with ${invalid}`, async () => {
    const f = fixture();
    const before = structuredClone(f.rules());
    const valid = [
      'https://first.public-fixture.invalid/rpc',
      'https://second.public-fixture.invalid/rpc',
    ];
    await expect(f.identity.configure([invalid, ...valid])).rejects.toThrow(
      'configuration is invalid'
    );
    const transport = jest.fn(async () => new Response('ok'));
    const fetcher = createPaliFetch(transport, f.identity);
    for (const url of valid) {
      expect(f.identity.isBackend(url)).toBe(true);
      await expect(fetcher(url)).rejects.toThrow('configuration is invalid');
      await expect(
        fetcher(url, { method: 'POST', body: '010203' })
      ).rejects.toThrow('identification is unavailable');
    }
    if (invalid.startsWith('https:')) {
      expect(f.identity.isBackend(invalid + '/api/v2/tx')).toBe(true);
      await expect(fetcher(invalid + '/api/v2/tx')).rejects.toThrow(
        'configuration is invalid'
      );
    }
    expect(transport).not.toHaveBeenCalled();
    expect(f.store.updateDynamicRules).not.toHaveBeenCalled();
    expect(f.rules()).toEqual(before);
    await f.identity.configure(valid);
    await fetcher(valid[0]);
    expect(transport).toHaveBeenCalledTimes(1);
  });
}

test('invalid reconfiguration preserves prior rules and blocks prior plus new wallet origins until corrected', async () => {
  const f = fixture();
  const old = 'https://old.public-fixture.invalid/rpc',
    next = 'https://new.public-fixture.invalid/rpc';
  await f.identity.configure([old]);
  const before = structuredClone(f.rules());
  await expect(f.identity.configure([next, 'bad endpoint'])).rejects.toThrow(
    'configuration is invalid'
  );
  expect(f.rules()).toEqual(before);
  expect(f.store.updateDynamicRules).toHaveBeenCalledTimes(1);
  const transport = jest.fn(async () => new Response('ok'));
  const fetcher = createPaliFetch(transport, f.identity);
  for (const url of [old, next]) {
    await expect(fetcher(url)).rejects.toThrow('configuration is invalid');
    await expect(
      fetcher(url, { method: 'POST', body: '010203' })
    ).rejects.toThrow('identification is unavailable');
  }
  const probe = jest.fn(async () => undefined);
  await expect(f.identity.withBackend(next, probe)).rejects.toThrow(
    'configuration is invalid'
  );
  expect(probe).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
  await f.identity.configure([next]);
  expect(f.identity.isReady(next)).toBe(true);
  expect(f.rules()).toHaveLength(2);
  expect(f.rules()[1].condition.urlFilter).toBe(
    '|https://new.public-fixture.invalid/'
  );
  await fetcher(next);
  expect(transport).toHaveBeenCalledTimes(1);
});

test('a prior installation completing after malformed configuration cannot reopen HTTP dispatch', async () => {
  const f = fixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.store.updateDynamicRules.mockImplementationOnce(async () => {
    await held;
  });
  const valid = 'https://rpc.example',
    installing = f.identity.configure([valid]);
  await expect(f.identity.configure([valid, 'invalid'])).rejects.toThrow(
    'configuration is invalid'
  );
  release();
  await installing;
  expect(f.identity.isReady(valid)).toBe(false);
  const transport = jest.fn(async () => new Response('ok'));
  await expect(createPaliFetch(transport, f.identity)(valid)).rejects.toThrow(
    'configuration is invalid'
  );
  expect(transport).not.toHaveBeenCalled();
  await f.identity.configure([valid]);
  expect(f.identity.isReady(valid)).toBe(true);
});

function heldUpdate(f: ReturnType<typeof fixture>) {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = f.store.updateDynamicRules.getMockImplementation()!;
  f.store.updateDynamicRules.mockImplementationOnce(async (options) => {
    entered();
    await held;
    return original(options);
  });
  return { started, release };
}

for (const phase of ['add', 'remove'] as const) {
  test(`installed active origin dispatches synchronously during unrelated candidate ${phase}`, async () => {
    const f = fixture();
    const active = 'https://active.public-fixture.invalid/rpc';
    const candidate = 'https://candidate.public-fixture.invalid/rpc';
    await f.identity.configure([active]);
    let operationEntered!: () => void;
    let finishOperation!: () => void;
    const operationStarted = new Promise<void>((resolve) => {
      operationEntered = resolve;
    });
    const operationHeld = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });
    let update = phase === 'add' ? heldUpdate(f) : undefined;
    const probing = f.identity.withBackend(candidate, async () => {
      operationEntered();
      await operationHeld;
    });
    void probing.catch(() => undefined);
    if (phase === 'add') await update!.started;
    else {
      await operationStarted;
      update = heldUpdate(f);
      finishOperation();
      await update.started;
    }
    const sent: Request[] = [];
    const fetcher = createPaliFetch(async (input) => {
      sent.push(input as Request);
      return new Response('ok');
    }, f.identity);
    try {
      const sending = fetcher(active, {
        method: 'POST',
        headers: { Authorization: 'Bearer public-active' },
        body: '010203',
      });
      void sending.catch(() => undefined);
      expect(sent).toHaveLength(1);
      await sending;
      expect(sent[0].headers.get('Authorization')).toBe('Bearer public-active');
      expect(await sent[0].text()).toBe('010203');
      if (phase === 'add') {
        await expect(
          fetcher(candidate, { method: 'POST', body: 'new-origin' })
        ).rejects.toThrow('identification is unavailable');
        expect(sent).toHaveLength(1);
      }
    } finally {
      update!.release();
      finishOperation();
      await probing;
    }
  });
}

test('queued removal then re-add blocks the active origin across the potential unmarked interval', async () => {
  const f = fixture(),
    active = 'https://active.public-fixture.invalid',
    other = 'https://other.public-fixture.invalid';
  await f.identity.configure([active]);
  const removing = heldUpdate(f);
  const removed = f.identity.configure([other]);
  const readded = f.identity.configure([active, other]);
  await removing.started;
  const adding = heldUpdate(f);
  const sent = jest.fn(async () => new Response('ok'));
  const fetcher = createPaliFetch(sent, f.identity);
  try {
    expect(f.identity.isReady(active)).toBe(false);
    await expect(
      fetcher(active, { method: 'POST', body: '010203' })
    ).rejects.toThrow('identification is unavailable');
    removing.release();
    await adding.started;
    // The old rule was removed, while the re-add has not yet reached Chrome.
    expect(f.identity.isReady(active)).toBe(false);
    await expect(
      fetcher(active, { method: 'POST', body: '010203' })
    ).rejects.toThrow('identification is unavailable');
    expect(sent).not.toHaveBeenCalled();
  } finally {
    removing.release();
    adding.release();
    await removed;
    await readded;
  }
  expect(f.identity.isReady(active)).toBe(true);
  await fetcher(active, { method: 'POST', body: '010203' });
  expect(sent).toHaveBeenCalledTimes(1);
});

test('failed unrelated atomic rule update keeps installed active origin ready without inventing a new installation', async () => {
  const f = fixture(),
    active = 'https://active.public-fixture.invalid',
    candidate = 'https://candidate.public-fixture.invalid';
  await f.identity.configure([active]);
  const before = structuredClone(f.rules());
  f.fail();
  await expect(f.identity.configure([active, candidate])).rejects.toThrow(
    'rule installation failed'
  );
  expect(f.rules()).toEqual(before);
  const sent = jest.fn(async () => new Response('ok'));
  const fetcher = createPaliFetch(sent, f.identity);
  const sending = fetcher(active, { method: 'POST', body: '010203' });
  void sending.catch(() => undefined);
  expect(sent).toHaveBeenCalledTimes(1);
  await sending;
  await expect(
    fetcher(candidate, { method: 'POST', body: '010203' })
  ).rejects.toThrow('identification is unavailable');
  expect(sent).toHaveBeenCalledTimes(1);
});

test('an explicit probe retains its configured origin through an overlapping registry change', async () => {
  const f = fixture(),
    active = 'https://active.public-fixture.invalid',
    other = 'https://other.public-fixture.invalid';
  await f.identity.configure([active]);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: Request[] = [];
  const fetcher = createPaliFetch(async (input) => {
    sent.push(input as Request);
    return new Response('ok');
  }, f.identity);
  const probing = f.identity.withBackend(active, async () => {
    entered();
    await held;
    return fetcher(active, { method: 'POST', body: 'public-read' });
  });
  await started;
  try {
    await f.identity.configure([other]);
    expect(f.identity.isReady(active)).toBe(true);
  } finally {
    release();
    await probing;
  }
  expect(sent).toHaveLength(1);
  expect(sent[0].headers.get('User-Agent')).toBe('PaliWallet');
  await f.identity.configure([other]);
  expect(f.identity.isBackend(active)).toBe(false);
});

test('removing an installed origin cannot fall through unrelated fetch while its rule update is pending', async () => {
  const f = fixture(),
    active = 'https://active.public-fixture.invalid',
    other = 'https://other.public-fixture.invalid';
  await f.identity.configure([active]);
  const held = heldUpdate(f);
  const removal = f.identity.configure([other]);
  await held.started;
  const transport = jest.fn(async () => new Response('ok'));
  try {
    expect(f.identity.isBackend(active)).toBe(true);
    expect(f.identity.isReady(active)).toBe(false);
    await expect(
      createPaliFetch(transport, f.identity)(active, {
        method: 'POST',
        body: '010203',
      })
    ).rejects.toThrow('identification is unavailable');
    expect(transport).not.toHaveBeenCalled();
  } finally {
    held.release();
    await removal;
  }
  expect(f.identity.isBackend(active)).toBe(false);
});
