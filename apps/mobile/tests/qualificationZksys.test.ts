import { qualifyNativeImportedEvm, matchesImportedRestartEvidence, isImportedQualificationReport } from '../qualification/imported-evm.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HDNodeWallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { qualifyNativeHdAccounts } from '../qualification/hd-accounts.ts';
import { qualifyNativeErc20Transfer } from '../qualification/erc20-transfer.ts';
import { qualifyNativeNevmTransfer } from '../qualification/nevm-transfer.ts';
import { qualifyNativeHdKeyReveal, matchesHdKeyRevealRestartEvidence } from '../qualification/hd-key-reveal.ts';
import {
  qualifyNativeZksysTransfer,
  isZksysQualificationReport,
  matchesZksysRestartEvidence,
} from '../qualification/zksys-transfer.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import { readSignedRecordEvidence, retainedSignedEntries } from '../qualification/signed-record-evidence.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'PUBLIC zkSYS native qualification password 1!';
const FIFTH_ADDRESS = '0x51cA8ff9f1C0a99f88E86B8112eA3237F55374cA';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
const evidence = (phase: 'create' | 'restart') => ({
  status: 'passed',
  phase,
  scenario: 'import',
  networkCalls: 0,
  fingerprint: 'f'.repeat(64),
  address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
  erc20Address: '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A',
  nevmAddress: '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E',
  transferHash: '0x' + '1'.repeat(64),
  firstTransferHash: '0x' + '2'.repeat(64),
  erc20TransferHash: '0x' + '3'.repeat(64),
  nevmTransferHash: '0x' + '4'.repeat(64),
  nevmEthereumTransferHash: '0x' + '5'.repeat(64),
  zksysTransferHash: '0x' + '6'.repeat(64),
  nativeZksysVerified: true,
  zksysAccountId: 'hd:60:4',
  zksysAccountIndex: 4,
  zksysAddress: FIFTH_ADDRESS,
  zksysChainId: '57057',
  zksysJournalContainerVersion: 1,
  zksysSignatures: phase === 'create' ? 1 : 0,
  zksysAuthorizations: phase === 'create' ? 0 : 1,
  zksysInjectedBroadcasts: 1,
  zksysFeeEstimates: phase === 'create' ? 2 : 0,
  zksysRestoredFromJournal: phase === 'restart',
});

test('zkSYS report rejects missing, forged or cross-phase evidence', () => {
  assert(isZksysQualificationReport(evidence('create')));
  assert(matchesZksysRestartEvidence(evidence('create'), evidence('restart')));
  const fields = Object.keys(evidence('create')).filter(
    (k) => k.startsWith('zksys') || k === 'nativeZksysVerified'
  );
  for (const field of fields) {
    const missing = { ...evidence('create') } as Record<string, unknown>;
    delete missing[field];
    assert.equal(isZksysQualificationReport(missing), false);
    assert.equal(
      isZksysQualificationReport({ status: 'failed', [field]: true }),
      false
    );
  }
  for (const change of [
    { zksysAccountId: 'hd:60:3' },
    { zksysAccountIndex: 3 },
    { zksysChainId: 57057 },
    { zksysAddress: evidence('create').nevmAddress },
    { zksysAddress: 'invalid' },
    { zksysTransferHash: evidence('create').nevmTransferHash },
    { zksysTransferHash: '0x1' },
    { zksysSignatures: 1 },
    { zksysAuthorizations: 0 },
    { zksysFeeEstimates: 2 },
    { zksysInjectedBroadcasts: 0 },
    { zksysRestoredFromJournal: false },
    { phase: ['restart'] },
    { scenario: ['import'] },
    { networkCalls: 1 },
    { fingerprint: 'e'.repeat(64) },
  ])
    assert.equal(
      matchesZksysRestartEvidence(evidence('create'), {
        ...evidence('restart'),
        ...change,
      }),
      false
    );
  assert.equal(isZksysQualificationReport({ status: 'failed' }), true);
  assert.equal(matchesZksysRestartEvidence({}, {}), false);
});
async function sqliteDisk() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-qualification-'));
  const file = path.join(directory, 'wallet.sqlite');
  let initialized = false;
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  const factory = createKeyringRuntimeFactory({
    ensureCryptoReady: async () => { assert(globalThis.crypto.subtle); },
    async openStorage() {
      storage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, !initialized);
      initialized = true;
      return storage;
    },
  });
  return {
    get runtime() { return runtime; },
    get storage() { return storage; },
    owner: { async open() { runtime = await factory.open() as KeyringRuntime; return runtime; } },
    async snapshot(excludeSuccessfulAuthentication = false) {
      const snapshot = await storage.recovery.readSnapshot();
      if (!excludeSuccessfulAuthentication) return JSON.stringify(snapshot);
      // Real successful authentication refreshes lastAttempt; private domains
      // and every other metadata row must remain byte-exact.
      const row = snapshot.metadata.find(entry => entry.key === 'auth');
      assert(row);
      const authentication = JSON.parse(row.value);
      assert.equal(authentication.version, 1);
      assert.equal(authentication.failures, 0);
      assert.equal(authentication.notBefore, 0);
      return JSON.stringify({ ...snapshot, metadata: snapshot.metadata.filter(entry => entry.key !== 'auth') });
    },
    async replaceSigned(profile: string, value: string) {
      // Corrupt the physical fixture directly; do not weaken production admission.
      const external = nodeConnection(file);
      try { await external.connection.runAsync('UPDATE evm_signed_records SET value = ? WHERE profile_id = ?', [value, profile]); }
      finally { await external.connection.closeAsync(); }
    },
    async close() { await rm(directory, { recursive: true, force: true }); },
  };
}

for (const scenario of ['import', 'generate'] as const) {
  test(
    `zkSYS ${scenario} uses the installed SDK and exact-fee controller, preserving all prior journals across restart`,
    { timeout: 120000 },
    async () => {
      const disk = await sqliteDisk();
      let authority = new NativeCustodyAuthority(disk.owner);
      const originalFetch = globalThis.fetch;
      let networkCalls = 0;
      globalThis.fetch = (() => {
        networkCalls++;
        throw Error('NETWORK_FORBIDDEN');
      }) as typeof fetch;
      const check = async <T>(_name: string, work: () => Promise<T>) => work();
      const rows = async () => {
        const evidence = await readSignedRecordEvidence(disk.storage);
        const addresses = authority.getCatalogue()!.accounts.filter(entry => entry.type === 'HDAccount' && entry.index < 4).map(entry => entry.address);
        return retainedSignedEntries(evidence.entries, addresses);
      };
      try {
        await authority.initialize();
        if (scenario === 'import')
          await authority.importPhrase(PHRASE, PASSWORD);
        else await authority.create(PASSWORD);
        const words = await disk.runtime.backup.readPhrase(PASSWORD);
        const derived = [1, 2, 3, 4].map(
          (index) =>
            HDNodeWallet.fromPhrase(
              words.join(' '),
              undefined,
              `m/44'/60'/0'/0/${index}`
            ).address
        );
        if (scenario === 'import') assert.equal(derived[3], FIFTH_ADDRESS);
        await disk.runtime.backup.confirm(
          await disk.runtime.backup.fingerprint()
        );
        await authority.refreshAuthenticatedMetadata();
        const options = () => ({
          authority,
          runtime: disk.runtime,
          storage: disk.storage,
          password: PASSWORD,
          check,
        });
        const hd = await qualifyNativeHdAccounts({
          ...options(),
          phase: 'create',
          expectedSecondAddress: derived[0],
        });
        const erc20 = await qualifyNativeErc20Transfer({
          ...options(),
          phase: 'create',
          expectedThirdAddress: derived[1],
        });
        const nevm = await qualifyNativeNevmTransfer({
          ...options(),
          phase: 'create',
          expectedFourthAddress: derived[2],
        });
        const older = await rows();
        const beforeInvalid = await disk.snapshot();
        await assert.rejects(
          qualifyNativeZksysTransfer({
            ...options(),
            phase: 'create',
            expectedFifthAddress: ['invalid'] as any,
          }),
          /QUALIFICATION_ZKSYS_ASSERTION_FAILED/
        );
        assert.equal(await disk.snapshot(), beforeInvalid);
        const created = await qualifyNativeZksysTransfer({
          ...options(),
          phase: 'create',
          expectedFifthAddress: derived[3],
        });
        assert.deepEqual(await rows(), older);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        assert.equal(authority.getSnapshot().account?.network, 'ethereum');
        const savedBundle = await readSignedRecordEvidence(disk.storage);
        const stored = savedBundle.entries.filter(entry => entry.from === created.zksysAddress.toLowerCase());
        assert.equal(stored.length, 1);
        await authority.manageAccounts({ kind: 'select', id: 'hd:60:4' }, authority.getSnapshot().revision, authority.getCatalogue()!.revision);
        await authority.selectNetwork('zksys-testnet', authority.getSnapshot().revision, authority.getCatalogue()!.revision);
        const saved = await (await disk.runtime.transfers!.journal(() => undefined)).load();
        assert.equal(saved!.hash, stored[0]!.hash);
        const signed = Transaction.from(saved!.rawTransaction);
        assert.equal(signed.chainId, 57057n); assert.equal(signed.nonce, 0); assert.equal(signed.maxPriorityFeePerGas, 0n);
        assert.equal(signed.maxFeePerGas, 25n); assert.equal(signed.gasLimit, 36000n); assert.equal(signed.value, 789n);
        assert.equal(stored[0]!.phase, 'signed'); assert(!savedBundle.raw!.includes(saved!.rawTransaction));
        await authority.selectNetwork('ethereum', authority.getSnapshot().revision, authority.getCatalogue()!.revision);
        await authority.manageAccounts({ kind: 'select', id: 'hd:60:1' }, authority.getSnapshot().revision, authority.getCatalogue()!.revision);
        const fingerprint = await disk.storage.getWalletFingerprint();
        const beforeKeyReveal = await disk.snapshot(true);
        const keyReveal = await qualifyNativeHdKeyReveal({ ...options(), expectedAddress: hd.address });
        assert.deepEqual(keyReveal, { nativeHdKeyRevealVerified: true });
        assert(await disk.snapshot(true) === beforeKeyReveal, 'Key reveal must preserve all stored records');
        const imported = await qualifyNativeImportedEvm({ ...options(), phase: 'create' });
        const firstReport = {
          status: 'passed',
          phase: 'create',
          scenario,
          networkCalls,
          fingerprint,
          ...hd,
          ...erc20,
          ...nevm,
          ...created,
          ...keyReveal,
          ...imported,
        };
        assert(isZksysQualificationReport(firstReport));
        assert(isImportedQualificationReport(firstReport));
        assert(!JSON.stringify(firstReport).includes(words.join(' ')));
        assert(!JSON.stringify(firstReport).includes(PASSWORD));
        assert(
          !JSON.stringify(firstReport).includes(
            saved!.rawTransaction
          )
        );
        await authority.dispose();
        authority = new NativeCustodyAuthority(disk.owner);
        await authority.initialize();
        await authority.unlock(PASSWORD);
        const hdAgain = await qualifyNativeHdAccounts({
          ...options(),
          phase: 'restart',
          expectedSecondAddress: derived[0],
          expectedRestartAddress: hd.address,
        });
        const erc20Again = await qualifyNativeErc20Transfer({
          ...options(),
          phase: 'restart',
          expectedThirdAddress: derived[1],
        });
        const nevmAgain = await qualifyNativeNevmTransfer({
          ...options(),
          phase: 'restart',
          expectedFourthAddress: derived[2],
        });
        const oldAfterEarlierRetries = await rows();
        const noSignRuntime: KeyringRuntime = {
          ...disk.runtime,
          transfers: {
            ...disk.runtime.transfers!,
            async sign() {
              throw Error('RESTART_MUST_NOT_SIGN');
            },
          },
        };
        if (scenario === 'import') {
          const evidence = await readSignedRecordEvidence(disk.storage);
          const original = JSON.parse(evidence.raw!);
          const profile = (await disk.storage.recovery!.readIdentity())!.root!.profileId;
          await disk.replaceSigned(profile, JSON.stringify({ ...original, entries: original.entries.filter((entry: { hash: string }) => entry.hash !== stored[0]!.hash) }));
          await assert.rejects(
            qualifyNativeZksysTransfer({
              ...options(),
              runtime: noSignRuntime,
              phase: 'restart',
              expectedFifthAddress: derived[3],
            })
          );
          await disk.replaceSigned(profile, evidence.raw!);
          if (authority.getSnapshot().phase === 'locked') await authority.unlock(PASSWORD);
          if (authority.getSnapshot().account?.network !== 'ethereum')
            await authority.selectNetwork(
              'ethereum',
              authority.getSnapshot().revision,
              authority.getCatalogue()!.revision
            );
          await authority.manageAccounts(
            { kind: 'select', id: 'hd:60:1' },
            authority.getSnapshot().revision,
            authority.getCatalogue()!.revision
          );
        }
        const restored = await qualifyNativeZksysTransfer({
          ...options(),
          runtime: noSignRuntime,
          phase: 'restart',
          expectedFifthAddress: scenario === 'import' ? derived[3] : undefined,
        });
        assert.equal(restored.zksysSignatures, 0);
        assert.equal(restored.zksysAuthorizations, 1);
        assert.equal(restored.zksysFeeEstimates, 0);
        assert.equal(restored.zksysTransferHash, created.zksysTransferHash);
        const after = await readSignedRecordEvidence(disk.storage);
        const retained = after.entries.find(entry => entry.hash === stored[0]!.hash);
        assert.equal(retained?.phase, 'submitted');
        assert.equal(restored.zksysTransferHash, signed.hash);
        assert.deepEqual(await rows(), oldAfterEarlierRetries);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        assert.equal(authority.getSnapshot().account?.network, 'ethereum');
        const beforeRestartKeyReveal = await disk.snapshot(true);
        const keyRevealAgain = await qualifyNativeHdKeyReveal({ ...options(), expectedAddress: hdAgain.address });
        assert.deepEqual(keyRevealAgain, keyReveal);
        assert(await disk.snapshot(true) === beforeRestartKeyReveal, 'Restart key reveal must preserve all stored records');
        assert(matchesHdKeyRevealRestartEvidence(firstReport, { status: 'passed', phase: 'restart', ...hdAgain, ...keyRevealAgain }));
        assert(
          matchesZksysRestartEvidence(firstReport, {
            status: 'passed',
            phase: 'restart',
            scenario,
            networkCalls,
            fingerprint,
            ...hdAgain,
            ...erc20Again,
            ...nevmAgain,
            ...restored,
          })
        );
        const importedAgain = await qualifyNativeImportedEvm({ ...options(), phase: 'restart', runtime: noSignRuntime });
        assert(matchesImportedRestartEvidence(firstReport, { status: 'passed', phase: 'restart', scenario, networkCalls, fingerprint, ...importedAgain }));
        assert.equal(networkCalls, 0);
      } finally {
        await authority.dispose().catch(() => undefined);
        globalThis.fetch = originalFetch;
        await disk.close();
      }
    }
  );
}
