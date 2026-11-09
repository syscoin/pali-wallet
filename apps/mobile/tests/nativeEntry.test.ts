import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { isCryptoDiagnostic } from '../src/crypto/diagnostics.ts';
import { isHdQualificationReport } from '../qualification/hd-accounts.ts';
import { isErc20QualificationReport } from '../qualification/erc20-transfer.ts';
import { isStorageQualificationDiagnostic } from '../qualification/storage-diagnostics.ts';
import { loadAfterNativeCrypto } from '../src/startup/loadAfterCrypto.ts';
const { decodeNativeReport, assertFullNativeReport } = createRequire(import.meta.url)('../qualification/report-validation.cjs');
const { importedEvidence } = createRequire(import.meta.url)('../qualification/imported-report-fixture.cjs');

const root = fileURLToPath(new NodeURL('../', import.meta.url));
const { readQualificationSdkPin } = createRequire(import.meta.url)('../scripts/qualification-sdk.cjs');
const sdkPin = readQualificationSdkPin(root);
const sdkVersion = sdkPin.identity;
const { CHECKS } = createRequire(import.meta.url)('../qualification/simulator-contract.cjs');
const erc20Evidence = (phase = 'create') => ({
  nativeErc20Verified: true, erc20AccountId: 'hd:60:2', erc20AccountIndex: 2,
  erc20Address: '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A',
  erc20TransferHash: '0x' + 'd'.repeat(64), erc20IntentHash: '0x' + 'e'.repeat(64),
  erc20Signatures: phase === 'create' ? 1 : 0, erc20Authorizations: phase === 'restart' ? 1 : 0,
  erc20InjectedBroadcasts: 1, erc20RestoredFromJournal: phase === 'restart',
});
const nevmEvidence = (phase = 'create') => ({
  nativeNevmVerified: true, nevmAccountId: 'hd:60:3', nevmAccountIndex: 3,
  nevmAddress: '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E',
  nevmTransferHash: '0x' + '7'.repeat(64), nevmEthereumTransferHash: '0x' + '8'.repeat(64),
  nevmChainId: '5700', nevmJournalContainerVersion: 1,
  nevmRestoredFromJournal: phase === 'restart',
});
const zksysEvidence = (phase = 'create') => ({
  nativeZksysVerified: true, zksysAccountId: 'hd:60:4', zksysAccountIndex: 4,
  zksysAddress: '0x51cA8ff9f1C0a99f88E86B8112eA3237F55374cA',
  zksysTransferHash: '0x' + '9'.repeat(64), zksysChainId: '57057', zksysJournalContainerVersion: 1,
  zksysSignatures: phase === 'create' ? 1 : 0, zksysAuthorizations: phase === 'create' ? 0 : 1,
  zksysInjectedBroadcasts: 1, zksysFeeEstimates: phase === 'create' ? 2 : 0,
  zksysRestoredFromJournal: phase === 'restart',
});

test('application evaluation waits for the complete crypto gate', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: string[] = [];
  const loading = loadAfterNativeCrypto(
    async () => {
      events.push('qualification');
      await gate;
      events.push('installed');
    },
    () => {
      events.push('app');
      return 'loaded';
    }
  );
  assert.deepEqual(events, ['qualification']);
  release();
  assert.equal(await loading, 'loaded');
  assert.deepEqual(events, ['qualification', 'installed', 'app']);
});

test('a failed gate settles before watch-only application evaluation', async () => {
  const events: string[] = [];
  const result = await loadAfterNativeCrypto(
    async () => {
      await Promise.resolve();
      events.push('unavailable');
      throw Error('synthetic native failure');
    },
    () => {
      events.push('watch-only');
      return true;
    }
  );
  assert.equal(result, true);
  assert.deepEqual(events, ['unavailable', 'watch-only']);
});

// Select the same real noble browser crypto.js branch that Metro uses. Node's
// default exports instead choose cryptoNode.js, which would conceal this bug.
const probe = `
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(process.cwd() + '/package.json');
const browserCrypto = pathToFileURL(join(dirname(require.resolve('@noble/hashes/sha256')), 'crypto.js')).href;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@noble/hashes/crypto') return { url: browserCrypto, shortCircuit: true };
  return next(specifier, context);
}});
const { loadAfterNativeCrypto } = await import(pathToFileURL(process.cwd() + '/src/startup/loadAfterCrypto.ts').href);
const old = { getRandomValues() { throw Error('OLD_CRYPTO'); } };
Object.defineProperty(globalThis, 'crypto', { value: old, configurable: true });
let calls = 0;
const installed = { getRandomValues(value) { calls++; value.fill(0x42); return value; } };
const mode = process.env.PALI_ORDER_PROBE;
const eager = mode !== 'gated';
// The qualification Merkle entry loads this exact ESM graph before BIP39.
if (mode === 'eager-merkle') await import('ethers/crypto');
let bip39 = mode === 'eager' ? require('bip39') : undefined;
await loadAfterNativeCrypto(async () => {
  await Promise.resolve();
  Object.defineProperty(globalThis, 'crypto', { value: installed, configurable: true });
}, () => { bip39 ??= require('bip39'); });
if (eager) {
  assert.throws(() => bip39.generateMnemonic(128), /OLD_CRYPTO/);
  assert.equal(calls, 0);
} else {
  assert.equal(require('@noble/hashes/crypto').crypto, installed);
  const phrase = bip39.generateMnemonic(128);
  assert.equal(bip39.mnemonicToEntropy(phrase), '42'.repeat(16));
  assert.equal(calls, 1);
}
process.stdout.write(JSON.stringify({ mode, passed: true }));
`;
for (const mode of ['eager', 'eager-merkle', 'gated']) {
  test(`real BIP39/noble browser branch demonstrates ${mode} module capture`, () => {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe],
      {
        cwd: root,
        env: { ...process.env, PALI_ORDER_PROBE: mode },
        encoding: 'utf8',
        timeout: 15_000,
      }
    );
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { mode, passed: true });
  });
}

test('qualification observes entropy before the public Merkle dependency graph loads', () => {
  const source = readFileSync(new NodeURL('../qualification/index.tsx', import.meta.url), 'utf8');
  const observer = source.indexOf('value: observedCrypto');
  const merkle = source.indexOf("import('../src/crypto/qualificationPublicMerkle.ts')");
  assert(observer >= 0 && merkle > observer);
});

test('production and qualification entries cannot eagerly import the wallet graph', () => {
  const entry = readFileSync(
    new NodeURL('../index.ts', import.meta.url),
    'utf8'
  );
  assert.equal(entry.trim(), "import './src/entry';");
  for (const path of [
    '../src/entry.native.tsx',
    '../qualification/index.tsx',
  ]) {
    const source = readFileSync(new NodeURL(path, import.meta.url), 'utf8');
    const parsed = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const imports = parsed.statements
      .filter(ts.isImportDeclaration)
      .filter((item) => !item.importClause?.isTypeOnly)
      .map((item) => (item.moduleSpecifier as ts.StringLiteral).text);
    assert.equal(
      imports.some((name) =>
        /(?:\/App$|\/custody\/|\/core\/|^ethers|^bip39|^@noble)/.test(name)
      ),
      false,
      path
    );
  }
});

// Execute the real report validator without its process/device side effects.
test('native report validation requires the generated mnemonic entropy evidence', () => {
  const source = readFileSync(
    new NodeURL('../qualification/run-native.cjs', import.meta.url),
    'utf8'
  );
  const start = source.indexOf('const validateReport =');
  const end = source.indexOf('const waitReport =', start);
  assert(start >= 0 && end > start);
  const validate = runInNewContext(source.slice(start, end) + '\nvalidateReport;', {
    fullSlhConfiguration: null, fullSlhEnabled: false,
    decodeNativeReport, assertFullNativeReport, simulatorVersion: undefined,
    isHdQualificationReport, isErc20QualificationReport, isCryptoDiagnostic, isStorageQualificationDiagnostic, simulatorContract: false, PUBLIC_PHRASE: 'public fixture', PUBLIC_PASSWORD: 'public password', platform: 'ios',
    fs: { writeFileSync() {} }, path: { join: () => 'unused' }, output: 'unused',
  }) as (text: string, phase: string, scenario: string) => unknown;
  const report = { version: 1, status: 'passed', phase: 'create', scenario: 'generate', platform: 'ios',
    networkCalls: 0, nativeBridgeExercised: true, sdkVersion, nativeSigningVerified: true, nativeHdAccountsVerified: true, nativeHdKeyRevealVerified: true, selectedAccountId: 'hd:60:1', selectedAccountIndex: 1, journalContainerVersion: 1, firstTransferHash: '0x' + 'c'.repeat(64), address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0', transferHash: '0x' + 'b'.repeat(64), fingerprint: 'a'.repeat(64),
    ...(sdkPin.quickCryptoIdentity ? { quickCryptoIdentity: sdkPin.quickCryptoIdentity } : {}),
    checks: CHECKS.map((name: string) => ({ name, durationMs: 1 })),
    cryptoEvidence: { passed: true, productionIterations: 900000 }, cryptoDiagnostic: { bootstrap: 'ready', fullCase: 'random-view-boundaries' }, mnemonicEntropyVerified: true, storageDiagnostic: { stage: 'ready' }, ...erc20Evidence(), ...nevmEvidence(), ...zksysEvidence(), ...importedEvidence() };
  assert.doesNotThrow(() => validate(JSON.stringify(report), 'create', 'generate'));
  if (sdkPin.quickCryptoIdentity) {
    assert.throws(() => validate(JSON.stringify({ ...report, quickCryptoIdentity: undefined }), 'create', 'generate'));
    assert.throws(() => validate(JSON.stringify({ ...report, checks: report.checks.slice(0, -1) }), 'create', 'generate'));
  }
  assert.throws(() => validate(JSON.stringify({ ...report, selectedAccountId: 'hd:60:0' }), 'create', 'generate'));
  assert.throws(() => validate(JSON.stringify({ ...report, journalContainerVersion: 2 }), 'create', 'generate'));
  assert.throws(() => validate(JSON.stringify({ ...report, nativeSigningVerified: false }), 'create', 'generate'));
  assert.throws(() => validate(JSON.stringify({ ...report, transferHash: 'invalid' }), 'create', 'generate'));
  assert.throws(() => validate(JSON.stringify({ ...report, sdkVersion: '1.0.628' }), 'create', 'generate'));
  assert.throws(() => validate(JSON.stringify({ ...report, cryptoDiagnostic: { bootstrap: 'NATIVE_RAW_ERROR_SECRET' } }), 'create', 'generate'));
  assert.throws(() => validate(JSON.stringify({ ...report, mnemonicEntropyVerified: false }), 'create', 'generate'));
  const missing: Record<string, unknown> = { ...report };
  delete missing.mnemonicEntropyVerified;
  assert.throws(() => validate(JSON.stringify(missing), 'create', 'generate'));
  assert.doesNotThrow(() =>
    validate(
      JSON.stringify({
        ...report,
        phase: 'restart',
        mnemonicEntropyVerified: false,
        ...erc20Evidence('restart'), ...nevmEvidence('restart'), ...zksysEvidence('restart'), ...importedEvidence('restart'),
      }),
      'restart',
      'generate'
    )
  );
});

test('a pre-parameter startup failure is read immediately instead of waiting for a phase report', async () => {
  const source = readFileSync(
    new NodeURL('../qualification/run-native.cjs', import.meta.url),
    'utf8'
  );
  const start = source.indexOf('const validateReport =');
  const end = source.indexOf('const databaseEvidence =', start);
  const wait = runInNewContext(source.slice(start, end) + '\nwaitReport;', {
    fullSlhConfiguration: null, fullSlhEnabled: false,
    decodeNativeReport, assertFullNativeReport, simulatorVersion: undefined,
    isHdQualificationReport, isErc20QualificationReport, isCryptoDiagnostic, isStorageQualificationDiagnostic, simulatorContract: false, PUBLIC_PHRASE: 'public fixture', PUBLIC_PASSWORD: 'public password', platform: 'android',
    fs: { writeFileSync() {} }, path: { join: () => 'unused' }, output: 'unused',
  }) as (read: () => string | null, phase: string, scenario: string, startup: () => string) => Promise<unknown>;
  let phaseReads = 0;
  await assert.rejects(wait(() => { phaseReads++; return null; }, 'create', 'import', () => JSON.stringify({
    version: 1, status: 'failed', phase: 'unknown', scenario: 'unknown', platform: 'android',
    failedStage: 'parameters', cryptoDiagnostic: { bootstrap: 'unchecked' }, storageDiagnostic: {},
  })), /Native qualification failed at parameters/);
  assert.equal(phaseReads, 0);
  const entry = readFileSync(
    new NodeURL('../qualification/index.tsx', import.meta.url),
    'utf8'
  );
  assert(entry.includes("writeReport(parameters?.phase ?? 'startup', report)"));
});
