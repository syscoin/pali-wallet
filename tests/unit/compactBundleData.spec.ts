import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeedSync,
  validateMnemonic,
} from 'bip39';
import { Interface, JsonFragment, ParamType } from 'ethers/abi';
import { LangEn } from 'ethers/wordlists';
import fs from 'fs';

import compactAbiJson from '../../source/config/loaders/compactAbiJson';
import compactEnglishWordlist from '../../source/config/loaders/compactEnglishWordlist';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function readInstalledJson(modulePath: string): string {
  return fs.readFileSync(require.resolve(modulePath), 'utf8');
}

function executeGenerated<T>(source: string): T {
  const generatedModule = { exports: undefined as unknown };
  const scopedRequire = (modulePath: string) => {
    if (modulePath !== 'ethers/wordlists') {
      throw new Error(`Unexpected generated dependency: ${modulePath}`);
    }
    return jest.requireActual<typeof import('ethers/wordlists')>(modulePath);
  };
  // Execute only this build loader's locally generated fixture, outside production.
  const execute = new Function('module', 'require', source);
  execute(generatedModule, scopedRequire);
  return generatedModule.exports as T;
}

function expectExactMutableJson(
  original: JsonValue,
  emitted: JsonValue,
  references = new Set<object>()
): void {
  if (original === null || typeof original !== 'object') {
    expect(emitted).toBe(original);
    return;
  }
  expect(emitted).not.toBeNull();
  expect(typeof emitted).toBe('object');
  const emittedObject = emitted as object;
  expect(references.has(emittedObject)).toBe(false);
  references.add(emittedObject);
  expect(Object.getPrototypeOf(emitted)).toBe(Object.getPrototypeOf(original));
  expect(Reflect.ownKeys(emittedObject)).toEqual(Reflect.ownKeys(original));
  expect(Object.isExtensible(emitted)).toBe(Object.isExtensible(original));
  expect(Object.isSealed(emitted)).toBe(Object.isSealed(original));
  expect(Object.isFrozen(emitted)).toBe(Object.isFrozen(original));
  for (const key of Reflect.ownKeys(original)) {
    const expected = Object.getOwnPropertyDescriptor(original, key)!;
    const actual = Object.getOwnPropertyDescriptor(emittedObject, key)!;
    expect({ ...actual, value: undefined }).toEqual({
      ...expected,
      value: undefined,
    });
    expectExactMutableJson(expected.value, actual.value, references);
  }
}

function sampleAbiValue(parameter: ParamType): unknown {
  if (parameter.isArray()) {
    return Array.from(
      { length: parameter.arrayLength < 0 ? 2 : parameter.arrayLength },
      () => sampleAbiValue(parameter.arrayChildren)
    );
  }
  if (parameter.isTuple()) {
    return parameter.components.map(sampleAbiValue);
  }
  if (parameter.type === 'address') {
    return '0x1111111111111111111111111111111111111111';
  }
  if (parameter.type === 'bool') return true;
  if (parameter.type === 'string') return 'ABI parity fixture';
  if (/^u?int\d*$/.test(parameter.type)) return BigInt(7);
  const bytes = parameter.type.match(/^bytes(\d*)$/);
  if (bytes) return '0x' + '11'.repeat(Number(bytes[1]) || 3);
  throw new Error(`Unsupported fixture parameter: ${parameter.type}`);
}

const abiNames = ['erc20', 'erc721', 'erc1155'];
const englishSource = readInstalledJson('bip39/src/wordlists/english.json');
const englishOriginal: string[] = JSON.parse(englishSource);

describe('lossless compact contract ABI data', () => {
  it.each(abiNames)(
    'preserves every %s value, property order and independently mutable object',
    (name) => {
      const source = readInstalledJson(
        `@sidhujag/sysweb3-utils/cjs/abi/${name}.json`
      );
      const original: JsonValue[] = JSON.parse(source);
      const generated = compactAbiJson(source);
      const emitted = executeGenerated<JsonValue[]>(generated);

      expect(JSON.stringify(emitted)).toBe(JSON.stringify(original));
      expectExactMutableJson(original, emitted);
      (emitted[0] as Record<string, JsonValue>).mutation = true;
      emitted.push({ mutation: true });
      expect(JSON.stringify(original)).toBe(JSON.stringify(JSON.parse(source)));
      expect(executeGenerated<JsonValue[]>(generated)).toEqual(original);
    }
  );

  it.each(abiNames)(
    'preserves all %s fragments, selectors and encoded calls, results and events',
    (name) => {
      const source = readInstalledJson(
        `@sidhujag/sysweb3-utils/cjs/abi/${name}.json`
      );
      const original = new Interface(JSON.parse(source));
      const emitted = new Interface(
        executeGenerated<JsonFragment[]>(compactAbiJson(source))
      );

      expect(
        emitted.fragments.map((fragment) => fragment.format('json'))
      ).toEqual(original.fragments.map((fragment) => fragment.format('json')));
      for (const fragment of original.fragments) {
        if (fragment.type === 'function') {
          const signature = fragment.format('sighash');
          const expected = original.getFunction(signature)!;
          const actual = emitted.getFunction(signature)!;
          expect(actual.selector).toBe(expected.selector);
          const values = expected.inputs.map(sampleAbiValue);
          const data = original.encodeFunctionData(expected, values);
          expect(emitted.encodeFunctionData(actual, values)).toBe(data);
          expect(emitted.decodeFunctionData(actual, data)).toEqual(
            original.decodeFunctionData(expected, data)
          );
          const results = expected.outputs.map(sampleAbiValue);
          const result = original.encodeFunctionResult(expected, results);
          expect(emitted.encodeFunctionResult(actual, results)).toBe(result);
          expect(emitted.decodeFunctionResult(actual, result)).toEqual(
            original.decodeFunctionResult(expected, result)
          );
        }
        if (fragment.type === 'event') {
          const signature = fragment.format('sighash');
          const expected = original.getEvent(signature)!;
          const actual = emitted.getEvent(signature)!;
          expect(actual.topicHash).toBe(expected.topicHash);
          expect(actual.anonymous).toBe(expected.anonymous);
          expect(actual.inputs.map((input) => input.indexed)).toEqual(
            expected.inputs.map((input) => input.indexed)
          );
          const values = expected.inputs.map(sampleAbiValue);
          const event = original.encodeEventLog(expected, values);
          expect(emitted.encodeEventLog(actual, values)).toEqual(event);
          expect(
            emitted.decodeEventLog(actual, event.data, event.topics)
          ).toEqual(
            original.decodeEventLog(expected, event.data, event.topics)
          );
        }
        if (fragment.type === 'error') {
          const signature = fragment.format('sighash');
          const expected = original.getError(signature)!;
          const actual = emitted.getError(signature)!;
          expect(actual.selector).toBe(expected.selector);
          const values = expected.inputs.map(sampleAbiValue);
          expect(emitted.encodeErrorResult(actual, values)).toBe(
            original.encodeErrorResult(expected, values)
          );
        }
      }
    }
  );

  it('creates fresh nested constants and preserves own prototype-looking keys', () => {
    const source = JSON.stringify(
      [1, 2, 3].map((id) => ({
        id,
        constant: JSON.parse(
          '{"__proto__":{"polluted":true},"constructor":{"value":1},"items":[{"name":"same"}]}'
        ),
      }))
    );
    const original: JsonValue[] = JSON.parse(source);
    const emitted = executeGenerated<JsonValue[]>(compactAbiJson(source));

    expect(JSON.stringify(emitted)).toBe(source);
    expectExactMutableJson(original, emitted);
    const first = emitted[0] as Record<string, Record<string, JsonValue>>;
    expect(Object.hasOwn(first.constant, '__proto__')).toBe(true);
    expect('polluted' in first.constant).toBe(false);
    (first.constant.items as JsonValue[]).push('changed');
    expect(emitted[1]).toEqual(original[1]);
    expect(emitted[2]).toEqual(original[2]);
  });

  it('rejects a non-array contract ABI', () => {
    expect(() => compactAbiJson('{"type":"function"}')).toThrow(
      'Expected a contract ABI array'
    );
  });
});

describe('lossless compact BIP39 English data', () => {
  it('exports all 2048 words with the original plain-array shape and mutability', () => {
    const generated = compactEnglishWordlist(englishSource);
    const emitted = executeGenerated<string[]>(generated);

    expect(emitted).toHaveLength(2048);
    expect(JSON.stringify(emitted)).toBe(JSON.stringify(englishOriginal));
    expectExactMutableJson(englishOriginal, emitted);
    emitted[0] = 'changed';
    emitted.push('changed');
    expect(englishOriginal[0]).toBe('abandon');
    expect(LangEn.wordlist().getWord(0)).toBe('abandon');
    expect(executeGenerated<string[]>(generated)).toEqual(englishOriginal);
  });

  it.each([128, 160, 192, 224, 256])(
    'preserves BIP39 mnemonic and seed derivation for %i-bit entropy',
    (bits) => {
      const wordlist = executeGenerated<string[]>(
        compactEnglishWordlist(englishSource)
      );
      const entropy = Buffer.alloc(bits / 8, 0xa5).toString('hex');
      const mnemonic = entropyToMnemonic(entropy, englishOriginal);

      expect(entropyToMnemonic(entropy, wordlist)).toBe(mnemonic);
      expect(mnemonicToEntropy(mnemonic, wordlist)).toBe(entropy);
      expect(validateMnemonic(mnemonic, wordlist)).toBe(true);
      expect(
        mnemonicToSeedSync(entropyToMnemonic(entropy, wordlist), 'TREZOR')
      ).toEqual(mnemonicToSeedSync(mnemonic, 'TREZOR'));
    }
  );

  it('matches the standard zero-entropy BIP39 English seed vector', () => {
    const wordlist = executeGenerated<string[]>(
      compactEnglishWordlist(englishSource)
    );
    const mnemonic = entropyToMnemonic('00'.repeat(16), wordlist);

    expect(mnemonic).toBe(Array(11).fill('abandon').join(' ') + ' about');
    expect(mnemonicToSeedSync(mnemonic, 'TREZOR').toString('hex')).toBe(
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04'
    );
  });

  it('fails compilation if the supplied word list changes words, order or length', () => {
    const changedWord = [...englishOriginal];
    changedWord[0] = 'changed';
    for (const mismatch of [
      changedWord,
      [...englishOriginal].reverse(),
      englishOriginal.slice(1),
    ]) {
      expect(() => compactEnglishWordlist(JSON.stringify(mismatch))).toThrow(
        'BIP39 English data differs from the canonical word list'
      );
    }
  });
});
