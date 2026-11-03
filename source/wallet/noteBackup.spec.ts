import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  webcrypto,
} from 'crypto';

import {
  createNoteBackupCodec,
  inspectNoteBackupHeader,
  NOTE_BACKUP_FORMAT,
  NOTE_BACKUP_HEADER_BYTES,
  NOTE_BACKUP_KDF_ITERATIONS,
  NOTE_BACKUP_MAX_FILE_BYTES,
  validateNoteBackupPayload,
} from './noteBackup';
import vectors from './noteBackup.vectors.json';

const PASSWORD = 'Synthetic long password 🔐';
const NOTE = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
const PAYLOAD = {
  format: NOTE_BACKUP_FORMAT,
  version: 1,
  createdAt: 1700000000000,
  notes: [{ note: NOTE, createdAt: 1699999999999 }],
};
function provider(overrides: Record<string, any> = {}, entropy?: Uint8Array) {
  let offset = 0;
  return {
    getRandomValues: (array: Uint8Array) => {
      if (!entropy) return webcrypto.getRandomValues(array);
      array.set(entropy.subarray(offset, offset + array.length));
      offset += array.length;
      return array;
    },
    subtle: new Proxy(webcrypto.subtle, {
      get(target, key) {
        if (key in overrides) return overrides[key as string];
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  } as unknown as Crypto;
}
function codec(
  overrides: Record<string, any> = {},
  current: () => void = () => undefined,
  entropy?: Uint8Array
) {
  return createNoteBackupCodec({
    crypto: provider(overrides, entropy),
    assertCurrent: current,
  });
}
const packIndependent = (
  plaintext: Buffer,
  password = PASSWORD
): Uint8Array => {
  const header = Buffer.alloc(64);
  header.write('PALINOTE', 0, 'ascii');
  header.set([1, 1, 1, 0], 8);
  Buffer.from(Array.from({ length: 32 }, (_, i) => i)).copy(header, 12);
  Buffer.from(Array.from({ length: 12 }, (_, i) => i + 32)).copy(header, 44);
  header.writeUInt32BE(plaintext.length + 16, 56);
  const key = pbkdf2Sync(
    password,
    header.subarray(12, 44),
    900000,
    32,
    'sha512'
  );
  try {
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(44, 56));
    cipher.setAAD(header);
    return new Uint8Array(
      Buffer.concat([
        header,
        cipher.update(plaintext),
        cipher.final(),
        cipher.getAuthTag(),
      ])
    );
  } finally {
    key.fill(0);
  }
};
const openIndependent = (file: Uint8Array, password: string): string => {
  const bytes = Buffer.from(file);
  const key = pbkdf2Sync(
    password,
    bytes.subarray(12, 44),
    900000,
    32,
    'sha512'
  );
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      bytes.subarray(44, 56)
    );
    decipher.setAAD(bytes.subarray(0, 64));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      decipher.update(bytes.subarray(64, -16)),
      decipher.final(),
    ]).toString('utf8');
  } finally {
    key.fill(0);
  }
};

it.each(vectors.vectors)(
  'matches the independent 900k/AES-GCM vector $name byte for byte',
  async (vector) => {
    const file = new Uint8Array(Buffer.from(vector.fileHex, 'hex'));
    const entropy = new Uint8Array(
      Buffer.from(vector.saltHex + vector.nonceHex, 'hex')
    );
    expect(await codec().decrypt(file, vector.password)).toEqual(
      vector.payload
    );
    const generated = await codec({}, undefined, entropy).encrypt(
      vector.payload,
      vector.password
    );
    expect(Buffer.from(generated).toString('hex')).toBe(vector.fileHex);
    expect(JSON.parse(openIndependent(generated, vector.password))).toEqual(
      vector.payload
    );
  }
);

it('uses fresh entropy and non-extractable fixed-cost AES keys, never plaintext framing', async () => {
  const deriveKey = jest.fn(
    (...args: Parameters<typeof webcrypto.subtle.deriveKey>) =>
      webcrypto.subtle.deriveKey(...args)
  );
  const run = codec({ deriveKey });
  const a = await run.encrypt(PAYLOAD, PASSWORD);
  const b = await run.encrypt(PAYLOAD, PASSWORD);
  expect(Buffer.from(a)).not.toEqual(Buffer.from(b));
  expect(Buffer.from(a.subarray(12, 44))).not.toEqual(
    Buffer.from(b.subarray(12, 44))
  );
  expect(Buffer.from(a.subarray(44, 56))).not.toEqual(
    Buffer.from(b.subarray(44, 56))
  );
  expect(Buffer.from(a).includes(Buffer.from(NOTE))).toBe(false);
  expect(inspectNoteBackupHeader(a)).toEqual({
    version: 1,
    suite: 'PBKDF2-SHA512-A256GCM',
    ciphertextBytes: a.length - 64,
  });
  for (const call of deriveKey.mock.calls) {
    expect(call[0]).toMatchObject({
      name: 'PBKDF2',
      hash: 'SHA-512',
      iterations: NOTE_BACKUP_KDF_ITERATIONS,
    });
    expect(call[2]).toEqual({ name: 'AES-GCM', length: 256 });
    expect(call[3]).toBe(false);
    expect(call[4]).toEqual(['encrypt']);
  }
  expect(await run.decrypt(a, PASSWORD)).toEqual(PAYLOAD);
});

it('preserves historical uncertainty as inert allowlisted data', () => {
  const payload = validateNoteBackupPayload(vectors.vectors[1].payload);
  expect(payload.notes[0].history?.withdrawal).toEqual({
    outcome: 'unknown',
    mode: 'relayed',
    jobId: 'synthetic_job_1',
  });
  expect(Object.isFrozen(payload)).toBe(true);
  expect(Object.isFrozen(payload.notes)).toBe(true);
  expect(Object.isFrozen(payload.notes[0].history?.withdrawal)).toBe(true);
  expect('submit' in payload).toBe(false);
  expect('spendable' in payload.notes[0]).toBe(false);
});

it.each([
  { ...PAYLOAD, version: 2 },
  { ...PAYLOAD, chainId: 2 },
  { ...PAYLOAD, createdAt: -1 },
  { ...PAYLOAD, createdAt: 8640000000000001 },
  { ...PAYLOAD, notes: [{ ...PAYLOAD.notes[0], note: `${NOTE} ` }] },
  { ...PAYLOAD, notes: [{ ...PAYLOAD.notes[0], note: NOTE.toUpperCase() }] },
  { ...PAYLOAD, notes: [{ ...PAYLOAD.notes[0], privateKey: 'secret' }] },
  {
    ...PAYLOAD,
    notes: [
      {
        ...PAYLOAD.notes[0],
        history: {
          withdrawal: {
            outcome: 'unknown',
            mode: 'relayed',
            relayerEndpointHint: 'https://secret:credential@example.test',
          },
        },
      },
    ],
  },
  {
    ...PAYLOAD,
    notes: [
      {
        ...PAYLOAD.notes[0],
        history: { withdrawal: { outcome: 'unknown', mode: 'direct' } },
      },
    ],
  },
  {
    ...PAYLOAD,
    notes: [
      {
        ...PAYLOAD.notes[0],
        history: { withdrawal: { outcome: 'submitted', mode: 'relayed' } },
      },
    ],
  },
  {
    ...PAYLOAD,
    notes: [
      {
        ...PAYLOAD.notes[0],
        history: {
          withdrawal: { outcome: 'unknown', mode: 'relayed', jobId: '../run' },
        },
      },
    ],
  },
  {
    ...PAYLOAD,
    notes: [
      {
        ...PAYLOAD.notes[0],
        history: {
          withdrawal: { outcome: 'unknown', mode: 'relayed', proof: 'secret' },
        },
      },
    ],
  },
])(
  'rejects unsupported or unsafe payload %# before invoking the KDF',
  async (payload) => {
    const deriveKey = jest.fn();
    await expect(
      codec({ deriveKey }).encrypt(payload, PASSWORD)
    ).rejects.toMatchObject({
      code: 'BACKUP_INVALID_PAYLOAD',
      message: 'BACKUP_INVALID_PAYLOAD',
    });
    expect(deriveKey).not.toHaveBeenCalled();
  }
);

it('rejects accessors without invoking them, duplicate notes and invalid nonce bounds', () => {
  const getter = jest.fn(() => NOTE);
  const entry = Object.defineProperty({ createdAt: 0 }, 'note', {
    enumerable: true,
    get: getter,
  });
  expect(() =>
    validateNoteBackupPayload({ ...PAYLOAD, notes: [entry] })
  ).toThrow('BACKUP_INVALID_PAYLOAD');
  expect(getter).not.toHaveBeenCalled();
  expect(() =>
    validateNoteBackupPayload({
      ...PAYLOAD,
      notes: [PAYLOAD.notes[0], PAYLOAD.notes[0]],
    })
  ).toThrow('BACKUP_INVALID_PAYLOAD');
  for (const nonce of ['-1', '01', '18446744073709551616', '1.5']) {
    expect(() =>
      validateNoteBackupPayload({
        ...PAYLOAD,
        notes: [
          {
            ...PAYLOAD.notes[0],
            history: {
              deposit: {
                outcome: 'unknown',
                from: '0x' + '11'.repeat(20),
                nonce,
              },
            },
          },
        ],
      })
    ).toThrow('BACKUP_INVALID_PAYLOAD');
  }
});

it('rejects hidden, symbolic and accessor fields without evaluating caller code', () => {
  const getter = jest.fn(() => NOTE);
  const hiddenGetter = Object.defineProperty({ createdAt: 0 }, 'note', {
    get: getter,
  });
  const hiddenData = Object.defineProperty({ ...PAYLOAD.notes[0] }, 'secret', {
    value: 'unapproved',
  });
  const hiddenRequired = Object.defineProperty({ createdAt: 0 }, 'note', {
    value: NOTE,
  });
  const symbolic = { ...PAYLOAD.notes[0], [Symbol('secret')]: 'unapproved' };
  for (const entry of [hiddenGetter, hiddenData, hiddenRequired, symbolic]) {
    expect(() =>
      validateNoteBackupPayload({ ...PAYLOAD, notes: [entry] })
    ).toThrow('BACKUP_INVALID_PAYLOAD');
  }
  const root = Object.defineProperty({ ...PAYLOAD }, 'notes', { get: getter });
  expect(() => validateNoteBackupPayload(root)).toThrow(
    'BACKUP_INVALID_PAYLOAD'
  );
  expect(getter).not.toHaveBeenCalled();
});

it('requires dense plain arrays with only enumerable own data slots', () => {
  const getter = jest.fn(() => PAYLOAD.notes[0]);
  const hiddenSlot = Object.defineProperty([], '0', {
    value: PAYLOAD.notes[0],
  });
  const accessorSlot = Object.defineProperty([], '0', {
    enumerable: true,
    get: getter,
  });
  const overriddenMap = Object.assign([], {
    map: jest.fn(() => [{ note: 'unvalidated value', createdAt: 0 }]),
  });
  const customIterator = Object.assign([...PAYLOAD.notes], {
    [Symbol.iterator]: jest.fn(),
  });
  class CustomArray extends Array {}
  const subclass = new CustomArray();
  subclass.push(...PAYLOAD.notes);
  for (const notes of [
    Array(1),
    hiddenSlot,
    accessorSlot,
    overriddenMap,
    customIterator,
    subclass,
  ]) {
    expect(() => validateNoteBackupPayload({ ...PAYLOAD, notes })).toThrow(
      'BACKUP_INVALID_PAYLOAD'
    );
  }
  expect(getter).not.toHaveBeenCalled();
  expect(overriddenMap.map).not.toHaveBeenCalled();
  expect(customIterator[Symbol.iterator]).not.toHaveBeenCalled();
});

it('reads typed-array internal slots without invoking hostile getters or iterators', async () => {
  const getter = jest.fn(() => {
    throw new Error('untrusted getter detail');
  });
  class HostileBytes extends Uint8Array {
    get buffer(): ArrayBuffer {
      return getter();
    }
    get byteOffset(): number {
      return getter();
    }
    get byteLength(): number {
      return getter();
    }
    [Symbol.iterator](): ArrayIterator<number> {
      return getter();
    }
  }
  const good = new HostileBytes(Buffer.from(vectors.vectors[0].fileHex, 'hex'));
  expect(inspectNoteBackupHeader(good).version).toBe(1);
  const oversized = new HostileBytes(NOTE_BACKUP_MAX_FILE_BYTES + 1);
  const importKey = jest.fn();
  expect(() => inspectNoteBackupHeader(oversized)).toThrow(
    'BACKUP_INVALID_FORMAT'
  );
  await expect(
    codec({ importKey }).decrypt(oversized, PASSWORD)
  ).rejects.toMatchObject({
    code: 'BACKUP_INVALID_FORMAT',
    message: 'BACKUP_INVALID_FORMAT',
  });
  expect(getter).not.toHaveBeenCalled();
  expect(importKey).not.toHaveBeenCalled();
  const proxy = new Proxy(good, { get: getter });
  expect(() => inspectNoteBackupHeader(proxy)).toThrow('BACKUP_INVALID_FORMAT');
  expect(getter).not.toHaveBeenCalled();
});

it('accepts exactly 512 distinct notes and rejects the 513th before identity work', () => {
  const notes = Array.from({ length: 512 }, (_, i) => ({
    note: `tornado-eth-1-1-0x${(i + 1).toString(16).padStart(124, '0')}`,
    createdAt: 0,
  }));
  expect(validateNoteBackupPayload({ ...PAYLOAD, notes }).notes).toHaveLength(
    512
  );
  expect(() =>
    validateNoteBackupPayload({ ...PAYLOAD, notes: [...notes, notes[0]] })
  ).toThrow('BACKUP_INVALID_PAYLOAD');
});

it('rejects bad framing, flags, suites and lengths before any KDF work', async () => {
  const good = new Uint8Array(Buffer.from(vectors.vectors[0].fileHex, 'hex'));
  const importKey = jest.fn();
  const cases = [
    new Uint8Array(),
    new Uint8Array(NOTE_BACKUP_MAX_FILE_BYTES + 1),
    good.slice(0, -1),
    new Uint8Array([...good, 0]),
  ];
  for (const offset of [0, 8, 9, 10, 11, 56, 60]) {
    const bad = good.slice();
    bad[offset] ^= 0xff;
    cases.push(bad);
  }
  for (const file of cases) {
    await expect(
      codec({ importKey }).decrypt(file, PASSWORD)
    ).rejects.toMatchObject({
      code: 'BACKUP_INVALID_FORMAT',
      message: 'BACKUP_INVALID_FORMAT',
    });
  }
  expect(importKey).not.toHaveBeenCalled();
});

it('returns the same static failure for wrong passwords, tampered salts/nonces and ciphertext', async () => {
  const vector = vectors.vectors[1];
  const good = new Uint8Array(Buffer.from(vector.fileHex, 'hex'));
  await expect(codec().decrypt(good, 'x')).rejects.toMatchObject({
    code: 'BACKUP_OPEN_FAILED',
    message: 'BACKUP_OPEN_FAILED',
  });
  for (const offset of [12, 44, NOTE_BACKUP_HEADER_BYTES, good.length - 1]) {
    const bad = good.slice();
    bad[offset] ^= 1;
    await expect(codec().decrypt(bad, vector.password)).rejects.toMatchObject({
      code: 'BACKUP_OPEN_FAILED',
      message: 'BACKUP_OPEN_FAILED',
    });
  }
});

it.each([
  '',
  'a'.repeat(11),
  '🔐'.repeat(6),
  'a'.repeat(1025),
  'é'.repeat(513),
  '\ud800',
  '\udc00',
])(
  'rejects invalid encryption password %# before key derivation',
  async (password) => {
    const importKey = jest.fn();
    await expect(
      codec({ importKey }).encrypt(PAYLOAD, password)
    ).rejects.toMatchObject({ code: 'BACKUP_INVALID_PASSWORD' });
    expect(importKey).not.toHaveBeenCalled();
  }
);

it('keeps exact Unicode password bytes and accepts offset views without retaining caller buffers', async () => {
  const vector = vectors.vectors[2];
  const raw = Buffer.from(vector.fileHex, 'hex');
  const source = new Uint8Array(raw.length + 16);
  source.set(raw, 7);
  expect(
    await codec().decrypt(source.subarray(7, 7 + raw.length), vector.password)
  ).toEqual(vector.payload);
  await expect(
    codec().decrypt(raw, vector.password.normalize('NFC'))
  ).rejects.toMatchObject({ code: 'BACKUP_OPEN_FAILED' });
});

it.each([
  Buffer.from(
    '{"format":"pali-private-notes","format":"pali-private-notes","version":1,"createdAt":0,"notes":[]}'
  ),
  Buffer.from(
    '{ "format":"pali-private-notes","version":1,"createdAt":0,"notes":[]}'
  ),
  Buffer.from(
    '{"format":"pali-private-notes","version":1,"createdAt":0,"notes":[],"extra":true}'
  ),
  Buffer.from('['.repeat(20) + '0' + ']'.repeat(20)),
  Buffer.from('["' + 'a'.repeat(2049) + '"]'),
  Buffer.from('[' + Array(12001).fill('0').join(',') + ']'),
  Buffer.from([0xff, 0xfe]),
])(
  'rejects authenticated noncanonical, oversized-work or malformed payload %#',
  async (plaintext) => {
    await expect(
      codec().decrypt(packIndependent(plaintext), PASSWORD)
    ).rejects.toMatchObject({ code: 'BACKUP_INVALID_PAYLOAD' });
  }
);

it('uses only static operational errors and wipes transient password/plaintext bytes', async () => {
  let password!: Uint8Array;
  let plaintext!: Uint8Array;
  const importKey = (...args: any[]) => {
    password = args[1];
    return (webcrypto.subtle.importKey as any)(...args);
  };
  const encrypt = (...args: any[]) => {
    plaintext = args[2];
    throw new Error(`${PASSWORD} ${NOTE}`);
  };
  await expect(
    codec({ importKey, encrypt }).encrypt(PAYLOAD, PASSWORD)
  ).rejects.toMatchObject({
    code: 'BACKUP_UNAVAILABLE',
    message: 'BACKUP_UNAVAILABLE',
  });
  expect(password.every((value) => value === 0)).toBe(true);
  expect(plaintext.every((value) => value === 0)).toBe(true);
});

it('rejects late completion after revocation and owns the payload before awaiting', async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let revoked = false;
  const deriveKey = async (...args: any[]) => {
    const key = await (webcrypto.subtle.deriveKey as any)(...args);
    entered();
    await waiting;
    return key;
  };
  const encrypt = jest.fn();
  const payload = JSON.parse(JSON.stringify(PAYLOAD));
  const result = codec({ deriveKey, encrypt }, () => {
    if (revoked) throw new Error(PASSWORD);
  }).encrypt(payload, PASSWORD);
  await started;
  payload.notes[0].note = 'changed';
  revoked = true;
  release();
  await expect(result).rejects.toMatchObject({
    code: 'BACKUP_CANCELLED',
    message: 'BACKUP_CANCELLED',
  });
  expect(encrypt).not.toHaveBeenCalled();
});

it('owns caller payload and file bytes before asynchronous key derivation', async () => {
  for (const direction of ['encrypt', 'decrypt'] as const) {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deriveKey = async (...args: any[]) => {
      const key = await (webcrypto.subtle.deriveKey as any)(...args);
      entered();
      await waiting;
      return key;
    };
    const run = codec({ deriveKey });
    const payload = JSON.parse(JSON.stringify(PAYLOAD));
    const vector = vectors.vectors[1];
    const file = new Uint8Array(Buffer.from(vector.fileHex, 'hex'));
    const result =
      direction === 'encrypt'
        ? run.encrypt(payload, PASSWORD)
        : run.decrypt(file, vector.password);
    await started;
    if (direction === 'encrypt') payload.notes[0].note = 'caller mutation';
    else file.fill(0);
    release();
    const completed = await result;
    if (direction === 'encrypt') {
      expect(await codec().decrypt(completed, PASSWORD)).toEqual(PAYLOAD);
    } else expect(completed).toEqual(vector.payload);
  }
});

it('wipes a decrypted result and refuses publication when the operation is revoked during AES', async () => {
  const vector = vectors.vectors[1];
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let revoked = false;
  let decrypted!: ArrayBuffer;
  const decrypt = async (...args: any[]) => {
    decrypted = await (webcrypto.subtle.decrypt as any)(...args);
    entered();
    await waiting;
    return decrypted;
  };
  const result = codec({ decrypt }, () => {
    if (revoked) throw new Error(`${PASSWORD} ${NOTE}`);
  }).decrypt(
    new Uint8Array(Buffer.from(vector.fileHex, 'hex')),
    vector.password
  );
  await started;
  revoked = true;
  release();
  await expect(result).rejects.toMatchObject({
    code: 'BACKUP_CANCELLED',
    message: 'BACKUP_CANCELLED',
  });
  expect(new Uint8Array(decrypted).every((byte) => byte === 0)).toBe(true);
});

it('rejects an asynchronous operation guard before cryptographic work', async () => {
  const importKey = jest.fn();
  const run = codec({ importKey }, async () => {
    throw new Error(PASSWORD);
  });
  await expect(run.encrypt(PAYLOAD, PASSWORD)).rejects.toMatchObject({
    code: 'BACKUP_UNAVAILABLE',
  });
  expect(importKey).not.toHaveBeenCalled();
});

it('rejects an asynchronous entropy adapter without leaking its rejection', async () => {
  const importKey = jest.fn();
  const cryptography = provider({ importKey });
  cryptography.getRandomValues = (async () => {
    throw new Error(PASSWORD);
  }) as any;
  const run = createNoteBackupCodec({
    crypto: cryptography,
    assertCurrent: () => undefined,
  });
  await expect(run.encrypt(PAYLOAD, PASSWORD)).rejects.toMatchObject({
    code: 'BACKUP_UNAVAILABLE',
  });
  expect(importKey).not.toHaveBeenCalled();
});

it('fails closed when a required UTF-8 primitive is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder');
  try {
    Object.defineProperty(globalThis, 'TextEncoder', {
      configurable: true,
      value: undefined,
    });
    expect(() => codec()).toThrow('BACKUP_UNAVAILABLE');
  } finally {
    if (original) Object.defineProperty(globalThis, 'TextEncoder', original);
    else Reflect.deleteProperty(globalThis, 'TextEncoder');
  }
});
