/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  clearOwnedDebuggingPort,
  waitForOwnedDebuggingPort,
} from '../../e2e/harness/ownedDebuggingPort';

const endpoint = '/devtools/browser/12345678-1234-1234-1234-123456789abc';
let profile: string;
const file = () => path.join(profile, 'DevToolsActivePort');
const options = { timeoutMs: 100, pollIntervalMs: 10, isOpen: () => true };

beforeEach(() => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-owned-debug-port-'));
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  fs.rmSync(profile, { recursive: true, force: true });
});

test('waits for missing, empty and partially written records before accepting a complete port', async () => {
  const settled = jest.fn();
  const result = waitForOwnedDebuggingPort(profile, options).then((value) => {
    settled(value);
    return value;
  });
  for (const partial of [
    '',
    '31',
    '31234\n',
    '31234\n/devtools/browser/1234',
  ]) {
    fs.writeFileSync(file(), partial);
    await jest.advanceTimersByTimeAsync(10);
    expect(settled).not.toHaveBeenCalled();
  }
  fs.writeFileSync(file(), `31234\n${endpoint}`);
  await jest.advanceTimersByTimeAsync(10);
  await expect(result).resolves.toBe('31234');
});

test('clears a prior launch record without touching another profile', async () => {
  const other = path.join(profile, 'other-profile');
  fs.mkdirSync(other);
  fs.writeFileSync(
    path.join(other, 'DevToolsActivePort'),
    `19999\n${endpoint}`
  );
  fs.writeFileSync(file(), `18888\n${endpoint}`);
  clearOwnedDebuggingPort(profile);
  expect(fs.existsSync(file())).toBe(false);
  const result = waitForOwnedDebuggingPort(profile, options);
  fs.writeFileSync(file(), `30001\n${endpoint}\n`);
  await jest.advanceTimersByTimeAsync(10);
  await expect(result).resolves.toBe('30001');
  expect(fs.readFileSync(path.join(other, 'DevToolsActivePort'), 'utf8')).toBe(
    `19999\n${endpoint}`
  );
});

test.each(['0', '65536', '12x', '-1'])(
  'never accepts an invalid or out-of-range port %s',
  async (port) => {
    fs.writeFileSync(file(), `${port}\n${endpoint}`);
    await expect(waitForOwnedDebuggingPort(profile, options)).rejects.toThrow(
      'Invalid owned browser debugging port'
    );
  }
);

test.each(['missing', 'partial'])(
  'a %s record reaches the fixed timeout without a fallback',
  async (kind) => {
    if (kind === 'partial')
      fs.writeFileSync(file(), '31234\n/devtools/browser/1234');
    const failed = expect(
      waitForOwnedDebuggingPort(profile, options)
    ).rejects.toThrow('Timed out');
    await jest.advanceTimersByTimeAsync(100);
    await failed;
  }
);

test.each(['directory', 'symlink', 'hardlink'])(
  'refuses a %s rather than reading or removing it',
  async (kind) => {
    if (kind === 'directory') fs.mkdirSync(file());
    else {
      const target = path.join(profile, 'target');
      fs.writeFileSync(target, `31234\n${endpoint}`);
      if (kind === 'hardlink') fs.linkSync(target, file());
      else fs.symlinkSync(target, file());
    }
    expect(() => clearOwnedDebuggingPort(profile)).toThrow('Unsafe owned');
    await expect(waitForOwnedDebuggingPort(profile, options)).rejects.toThrow(
      'Unsafe owned'
    );
  }
);

test('a closed owner stops waiting and cannot accept a later record', async () => {
  let open = true;
  const failed = expect(
    waitForOwnedDebuggingPort(profile, { ...options, isOpen: () => open })
  ).rejects.toThrow('Owned browser closed');
  open = false;
  fs.writeFileSync(file(), `31234\n${endpoint}`);
  await jest.advanceTimersByTimeAsync(10);
  await failed;
});

test('extra records and oversized files remain invalid', async () => {
  fs.writeFileSync(file(), `31234\n${endpoint}\nextra`);
  await expect(waitForOwnedDebuggingPort(profile, options)).rejects.toThrow(
    'Invalid owned'
  );
  fs.writeFileSync(file(), '1'.repeat(1025));
  await expect(waitForOwnedDebuggingPort(profile, options)).rejects.toThrow(
    'Unsafe owned'
  );
});
