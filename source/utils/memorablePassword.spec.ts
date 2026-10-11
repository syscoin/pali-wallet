import { generateMemorablePassword } from './memorablePassword';

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const mockGetRandomValues = jest.fn();

beforeEach(() => {
  mockGetRandomValues.mockReset();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: mockGetRandomValues },
  });
});

afterEach(() => {
  if (cryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'crypto');
  }
  jest.restoreAllMocks();
});

it('draws eight independent English words and an unbiased digit using secure randomness', () => {
  const captured: Uint16Array[] = [];
  mockGetRandomValues.mockImplementation((samples: Uint16Array) => {
    captured.push(samples);
    samples.set(
      captured.length === 1
        ? [0, 2049, 4098, 6147, 8196, 10245, 12294, 14343, 65535]
        : [19]
    );
    return samples;
  });

  const password = generateMemorablePassword();
  expect(password).toBe(
    'Abandon-ability-able-about-above-absent-absorb-abstract-9'
  );
  expect(mockGetRandomValues).toHaveBeenCalledTimes(2);
  expect(captured[0].length).toBe(9);
  expect(captured[1].length).toBe(1);
  expect(
    captured.every((samples) => samples.every((value) => value === 0))
  ).toBe(true);
  expect(password).toMatch(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/
  );
  expect(password.split('-')).toHaveLength(9);
});

it('permits repeated words instead of introducing dependent sampling or a seed checksum', () => {
  mockGetRandomValues.mockImplementation((samples: Uint16Array) => {
    samples.fill(0);
    return samples;
  });

  expect(generateMemorablePassword()).toBe(
    'Abandon-abandon-abandon-abandon-abandon-abandon-abandon-abandon-0'
  );
});

it('samples every word equally over the complete 16-bit sample space', () => {
  let sample = 0;
  mockGetRandomValues.mockImplementation((samples: Uint16Array) => {
    samples.fill(0);
    samples[0] = sample;
    return samples;
  });
  const wordCounts = new Map<string, number>();
  for (sample = 0; sample < 65536; sample += 1) {
    const word = generateMemorablePassword().split('-')[0].toLowerCase();
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }

  expect(wordCounts.size).toBe(2048);
  expect([...wordCounts.values()].every((count) => count === 32)).toBe(true);
});

it('accepts the largest unbiased digit sample without another random draw', () => {
  mockGetRandomValues.mockImplementation((samples: Uint16Array) => {
    samples.fill(0);
    samples[8] = 65529;
    return samples;
  });

  expect(generateMemorablePassword().endsWith('-9')).toBe(true);
  expect(mockGetRandomValues).toHaveBeenCalledTimes(1);
});

it('fails closed when secure randomness is unavailable without using Math.random', () => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  });
  const insecureRandom = jest.spyOn(Math, 'random');
  let failure: Error;
  try {
    generateMemorablePassword();
  } catch (error) {
    failure = error;
  }
  const insecureCalls = insecureRandom.mock.calls.length;
  insecureRandom.mockRestore();

  expect(failure.message).toBe('Secure password generation is unavailable');
  expect(insecureCalls).toBe(0);
});

it('propagates cryptographic failure while clearing sampled bytes and never logging a password', () => {
  let captured: Uint16Array;
  mockGetRandomValues.mockImplementation((samples: Uint16Array) => {
    captured = samples;
    samples.fill(65535);
    throw new Error('synthetic crypto failure');
  });
  const log = jest.spyOn(console, 'log');
  const error = jest.spyOn(console, 'error');

  expect(generateMemorablePassword).toThrow('synthetic crypto failure');
  expect(captured.every((value) => value === 0)).toBe(true);
  expect(log).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

it('fails closed rather than hanging when the random source continually rejects', () => {
  const captured: Uint16Array[] = [];
  mockGetRandomValues.mockImplementation((samples: Uint16Array) => {
    captured.push(samples);
    samples.fill(65535);
    return samples;
  });

  expect(generateMemorablePassword).toThrow(
    'Secure password generation failed'
  );
  expect(mockGetRandomValues).toHaveBeenCalledTimes(17);
  expect(
    captured.every((samples) => samples.every((value) => value === 0))
  ).toBe(true);
});
