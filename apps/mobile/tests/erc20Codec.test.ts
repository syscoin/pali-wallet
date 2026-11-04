import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, URL as NodeURL } from 'node:url';
import {
  formatTokenUnits,
  parseErc20Decimals,
  parseErc20Text,
  parseErc20Units,
} from '../../../source/shared/erc20.ts';
import {
  normalizeErc20Address,
  parseErc20Metadata,
} from '../src/portfolio/erc20Metadata.ts';

const contractAddress = '0x52908400098527886E0F7030069857D2E4169EE7';
const metadata = {
  contractAddress,
  decimals: 18,
  name: 'Example token',
  symbol: 'EXAMPLE',
};
test('the shared codec loads without an extension dependency installation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-isolated-erc20-'));
  try {
    const isolated = path.join(directory, 'erc20.ts');
    await copyFile(
      new NodeURL('../../../source/shared/erc20.ts', import.meta.url),
      isolated
    );
    const codec = await import(pathToFileURL(isolated).href);
    assert.equal(
      codec.formatTokenUnits('9007199254740993', 2),
      '90071992547409.93'
    );
    assert.equal(codec.parseErc20Decimals(255n), 255);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('ERC20 identities normalize checksums and reject incomplete, zero or incorrectly checksummed contracts', () => {
  assert.equal(
    normalizeErc20Address(contractAddress.toLowerCase()),
    contractAddress
  );
  for (const value of [
    null,
    1,
    '0x1234',
    ` ${contractAddress}`,
    '0x' + '0'.repeat(40),
    contractAddress.replace('E0F', 'e0F'),
  ])
    assert.throws(() => normalizeErc20Address(value));
});
test('uint256 and uint8 values preserve the exact boundaries without accepting unsafe numeric coercion', () => {
  const maximum = (1n << 256n) - 1n;
  assert.equal(parseErc20Units(maximum), maximum.toString());
  assert.equal(parseErc20Units('0'), '0');
  assert.equal(parseErc20Units('9007199254740993'), '9007199254740993');
  for (const value of [
    0,
    Number.MAX_SAFE_INTEGER + 1,
    '',
    '00',
    '+1',
    '-1',
    '1e2',
    '1.0',
    maximum + 1n,
    -1n,
    undefined,
    { toString: () => '1' },
  ])
    assert.throws(() => parseErc20Units(value));
  assert.equal(parseErc20Decimals(0n), 0);
  assert.equal(parseErc20Decimals(255n), 255);
  for (const value of [-1, 256, 1.5, NaN, '18', null, { toString: () => '18' }])
    assert.throws(() => parseErc20Decimals(value));
});
test('exact token formatting handles precision beyond the native-coin formatter', () => {
  assert.equal(
    formatTokenUnits('123456789012345678901234567890', 0),
    '123456789012345678901234567890'
  );
  assert.equal(formatTokenUnits('1234500000000000000', 18), '1.2345');
  assert.equal(formatTokenUnits('1000', 3), '1.0');
  assert.equal(formatTokenUnits('1', 80), `0.${'0'.repeat(79)}1`);
  assert.equal(formatTokenUnits('1', 255), `0.${'0'.repeat(254)}1`);
  assert.equal(formatTokenUnits('0', 255), '0.0');
  assert.throws(() => formatTokenUnits('1', 256));
});
test('metadata text is bounded untrusted display data and rejects invisible controls and invalid Unicode', () => {
  assert.equal(parseErc20Text('Café 🪙', 'name'), 'Café 🪙');
  for (const value of [
    '',
    '   ',
    '\ud800',
    'x\u0000y',
    'x\n',
    'x\u202ey',
    'x\u200by',
    'x\u061cy',
    'x'.repeat(129),
  ])
    assert.throws(() => parseErc20Text(value, 'name'));
  assert.throws(() => parseErc20Text('x'.repeat(65), 'symbol'));
  assert.equal(parseErc20Text('X'.repeat(64), 'symbol').length, 64);
});
test('metadata produces a detached frozen projection and does not evaluate accessors or custom objects', () => {
  const input = { ...metadata };
  const actual = parseErc20Metadata(input);
  input.symbol = 'Changed';
  assert.equal(actual.symbol, metadata.symbol);
  assert.equal(Object.isFrozen(actual), true);
  let reads = 0;
  const getter = Object.defineProperty({ ...metadata }, 'name', {
    enumerable: true,
    get() {
      reads++;
      return 'name';
    },
  });
  assert.throws(() => parseErc20Metadata(getter));
  assert.equal(reads, 0);
  for (const value of [
    null,
    [],
    { ...metadata, extra: true },
    Object.create(metadata),
    { ...metadata, decimals: undefined },
  ])
    assert.throws(() => parseErc20Metadata(value));
});
