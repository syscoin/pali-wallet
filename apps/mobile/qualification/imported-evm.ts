import { readSignedRecordEvidence, retainedSignedEntries } from './signed-record-evidence.ts';
import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import type { NativeTransferRuntime } from '../src/custody/transfers.ts';
import { bindNativePrivateAuthentication, createNativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';

// Public offline fixtures only. Do not fund them; the harness never uses a real RPC.
const RETIRED_KEY = '0x' + '1'.padStart(64, '0');
const FIXTURE_KEY = '0x' + '2'.padStart(64, '0');
const ADDRESS = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF';
const CHAINS = Object.freeze(['1', '5700', '57057'] as const);
const NETWORKS = Object.freeze(['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet'] as const);
export const IMPORTED_REPORT_FIELDS = Object.freeze(['nativeImportedVerified', 'importedAccountId', 'importedAccountIndex', 'importedAddress',
  'importedChainIds', 'importedTransferHashes', 'importedJournalContainerVersion', 'importedSignatures',
  'importedAuthorizations', 'importedInjectedBroadcasts', 'importedRestoredFromJournal', 'importedKeyRevealVerified']);
export type ImportedQualificationEvidence = Readonly<{
  nativeImportedVerified: true; importedAccountId: string; importedAccountIndex: number; importedAddress: string;
  importedChainIds: readonly string[]; importedTransferHashes: readonly string[]; importedJournalContainerVersion: 1;
  importedSignatures: number; importedAuthorizations: number; importedInjectedBroadcasts: 3;
  importedRestoredFromJournal: boolean; importedKeyRevealVerified: true;
}>;
export function isImportedQualificationReport(report: Record<string, unknown>): boolean {
  if (report.status === 'failed') return IMPORTED_REPORT_FIELDS.every((field) => !Object.hasOwn(report, field));
  const chains = report.importedChainIds, hashes = report.importedTransferHashes;
  const otherHashes = [report.transferHash, report.firstTransferHash, report.erc20TransferHash,
    report.nevmTransferHash, report.nevmEthereumTransferHash, report.zksysTransferHash];
  return report.status === 'passed' && (report.phase === 'create' || report.phase === 'restart') &&
    (report.scenario === 'import' || report.scenario === 'generate') && report.networkCalls === 0 &&
    report.nativeImportedVerified === true && Number.isSafeInteger(report.importedAccountIndex) && Number(report.importedAccountIndex) >= 0 && Number(report.importedAccountIndex) <= 4095 && report.importedAccountId === `imported:60:${report.importedAccountIndex}` &&
    report.importedAddress === ADDRESS && ![report.address, report.erc20Address, report.nevmAddress, report.zksysAddress].includes(ADDRESS) &&
    report.importedJournalContainerVersion === 1 && report.importedKeyRevealVerified === true &&
    Array.isArray(chains) && chains.length === 3 && [0, 1, 2].every((i) => chains[i] === CHAINS[i]) &&
    Array.isArray(hashes) && hashes.length === 3 && [0, 1, 2].every((i) => typeof hashes[i] === 'string' && /^0x[0-9a-f]{64}$/.test(hashes[i])) &&
    new Set(hashes).size === 3 && hashes.every((hash) => !otherHashes.includes(hash)) && report.importedSignatures === (report.phase === 'create' ? 3 : 0) &&
    report.importedAuthorizations === (report.phase === 'create' ? 0 : 3) && report.importedInjectedBroadcasts === 3 &&
    report.importedRestoredFromJournal === (report.phase === 'restart');
}
export function matchesImportedRestartEvidence(created: Record<string, unknown>, restored: Record<string, unknown>): boolean {
  return created.status === 'passed' && restored.status === 'passed' && created.phase === 'create' && restored.phase === 'restart' &&
    created.scenario === restored.scenario && isImportedQualificationReport(created) && isImportedQualificationReport(restored) &&
    typeof created.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(created.fingerprint) &&
    ['fingerprint', 'importedAccountId', 'importedAccountIndex', 'importedAddress', 'importedJournalContainerVersion'].every((key) => created[key] === restored[key]) &&
    JSON.stringify(created.importedChainIds) === JSON.stringify(restored.importedChainIds) &&
    JSON.stringify(created.importedTransferHashes) === JSON.stringify(restored.importedTransferHashes);
}
function expect(value: unknown): asserts value { if (!value) throw Error('QUALIFICATION_IMPORTED_EVM_FAILED'); }

/** Actual native authority/SDK/storage with an injected, bounded offline RPC. No live transaction path. */
export async function qualifyNativeImportedEvm(options: Readonly<{
  phase: 'create' | 'restart'; authority: NativeCustodyAuthority; runtime: KeyringRuntime;
  storage: Pick<OpenWalletStorage, 'keyringStorage' | 'signedRecords' | 'recovery' | 'getWalletFingerprint'>;
  check: <T>(name: string, operation: () => Promise<T>) => Promise<T>;
}>): Promise<ImportedQualificationEvidence> {
  const { phase, authority, runtime, storage, check } = options;
  const [{ NativeTransfers }, { NativeTransferRpc },
    { getNativeNetwork }, { importedKeyIdentity }, { HdKeyExportFlow }, { Transaction }] = await Promise.all([
    import('../src/custody/transfers.ts'), import('../src/custody/transferRpc.ts'), import('../src/custody/networkContext.ts'), import('../src/custody/importedAccounts.ts'),
    import('../src/custody/hdKeyExport.ts'), import('ethers/transaction'),
  ]);
  expect(phase === 'create' || phase === 'restart');
  const catalogue = () => { const value = authority.getCatalogue(); expect(value); return value; };
  const state = () => authority.getSnapshot();
  const hd1 = catalogue().accounts.find((a) => a.id === 'hd:60:1');
  expect(hd1 && catalogue().active.accountId === hd1.id && state().phase === 'ready' && state().account?.network === 'ethereum');
  const fingerprint = await storage.getWalletFingerprint();
  const pair = JSON.stringify([await storage.keyringStorage.get('vault'), await storage.keyringStorage.get('vault-keys')]);
  const olderAddresses = Array.from({length: 5}, (_, i) => {
    const account = catalogue().accounts.find(a => a.id === `hd:60:${i}` && a.type === 'HDAccount'); expect(account); return account.address;
  });
  const older = retainedSignedEntries((await readSignedRecordEvidence(storage)).entries, olderAddresses);
  const manage = (id: string) => authority.manageAccounts({ kind: 'select', id }, state().revision, catalogue().revision);
  const importAccount = async (input: Parameters<typeof authority.importAccount>[0]) => {
    const scope = createNativePrivateAuthenticationScope(), abort = new AbortController();
    try {
      await authority.importAccount(input, state().revision, catalogue().revision, abort.signal,
        bindNativePrivateAuthentication(scope, { assertCurrent: () => {}, isPromptActive: () => false }));
    } finally { scope.retire(); abort.abort(); }
  };
  if (phase === 'create') {
    await check('native imported key allocation and retirement', async () => {
      expect(!catalogue().accounts.some((a) => a.type === 'Imported'));
      await importAccount({ privateKey: RETIRED_KEY, expectedAddress: importedKeyIdentity(RETIRED_KEY, 0).address,
        label: 'Qualification retired imported key' });
      expect(catalogue().active.accountId === 'imported:60:0');
      await manage(hd1.id);
      await authority.manageAccounts({ kind: 'remove', id: 'imported:60:0',}, state().revision, catalogue().revision);
      await importAccount({ privateKey: FIXTURE_KEY, expectedAddress: ADDRESS, label: 'Qualification imported key' });
    });
  }
  const imported = catalogue().accounts.find(account => account.type === 'Imported' && account.address === ADDRESS);
  expect(imported?.type === 'Imported');
  if (phase === 'restart') await check('native imported key cold rehydration', () => manage(imported.id));
  expect(catalogue().active.accountId === imported.id && state().account?.address === ADDRESS && state().backup === 'confirmed');
  const hashes: string[] = []; let signatures = 0, authorizations = 0, broadcasts = 0;
  const transfer = runtime.transfers; expect(transfer);
  for (const [i, network] of NETWORKS.entries()) {
    await authority.selectNetwork(network, state().revision, catalogue().revision, () => {});
    const revision = state().revision;
    const guard = () => expect(state().phase === 'ready' && state().revision === revision && state().account?.address === ADDRESS &&
      state().account?.network === network && catalogue().active.accountId === imported.id);
    const registration = getNativeNetwork(network);
    let expectedRaw: string | undefined, requests = 0;
    const wrapped: NativeTransferRuntime = {
    isAuthenticationRefusal: (error) => transfer.isAuthenticationRefusal(error),
    authenticateOperation: (...args) => transfer.authenticateOperation(...args),
    authorizeOperation: (...args) => transfer.authorizeOperation(...args),
    releaseOperationAuthorization: (...args) => transfer.releaseOperationAuthorization(...args),
    replay: (...args) => transfer.replay(...args),
      submit: (...args) => transfer.submit(...args),
      journal: (assertCurrent) => transfer.journal(assertCurrent),
      async sign(...args) { expect(phase === 'create'); signatures++; return transfer.sign(...args); },
      // The report counts the replay admission check separately from fresh operation authentication.
      assertUnlocked(...args) { expect(phase === 'restart'); authorizations++; return transfer.assertUnlocked(...args); },
    };
    const rpc = new NativeTransferRpc({ networkId: network, fetch: async (url, init) => {
      guard(); expect(url === registration.rpcUrl && init.method === 'POST' && init.credentials === 'omit' && init.redirect === 'error');
      expect(typeof init.body === 'string' && init.body.length < 5000 && !init.body.includes('Pali#1:') && !init.body.includes(FIXTURE_KEY) && ++requests <= 64);
      const body = JSON.parse(init.body) as { id: number; method: string; params: unknown[] };
      expect(Number.isSafeInteger(body.id) && Array.isArray(body.params));
      const p = body.params; let result: unknown;
      if (body.method === 'eth_chainId') result = `0x${BigInt(registration.chainId).toString(16)}`;
      else if (body.method === 'eth_getBlockByNumber') {
        expect(p.length === 2 && p[1] === false && ['latest', 'finalized', '0x64', '0x5a', '0x59'].includes(p[0] as string));
        const number = p[0] === 'latest' ? '0x64' : p[0] === 'finalized' ? '0x5a' : p[0];
        result = { number, hash: '0x' + (number === '0x64' ? 'a' : 'b').repeat(64), baseFeePerGas: '0xa', gasLimit: '0x1000000' };
      } else if (body.method === 'eth_getTransactionCount') { expect(p[0] === ADDRESS); result = '0x0'; }
      else if (body.method === 'eth_getBalance') { expect(phase === 'create' && p[0] === ADDRESS); result = '0xde0b6b3a7640000'; }
      else if (body.method === 'eth_gasPrice') { result = '0xb'; }
      else if (body.method === 'eth_feeHistory') { expect(phase === 'create'); result = { oldestBlock: '0x64', baseFeePerGas: ['0xa', '0xa'] }; }
      else if (body.method === 'eth_maxPriorityFeePerGas') { expect(phase === 'create'); result = '0x1'; }
      else if (body.method === 'eth_estimateGas') { expect(phase === 'create'); result = network === 'zksys-testnet' ? '0x7530' : '0x5208'; }
      else if (body.method === 'eth_getTransactionReceipt') result = null;
      else if (body.method === 'eth_sendRawTransaction') {
        const saved = await (await transfer.journal(guard)).load(); guard();
        expect(saved?.phase === 'signed' && p.length === 1 && p[0] === saved.rawTransaction);
        const tx = Transaction.from(saved.rawTransaction);
        expect(tx.from === ADDRESS && tx.chainId.toString() === CHAINS[i] && tx.to === hd1.address && tx.nonce === 0 &&
          tx.value === BigInt(111 * (i + 1)) && tx.type === 2 && tx.data === '0x');
        if (expectedRaw) expect(expectedRaw === saved.rawTransaction);
        expectedRaw = saved.rawTransaction; broadcasts++;
        if (phase === 'create') throw Error('QUALIFICATION_IMPORTED_LOST_RESPONSE');
        result = saved.hash;
      } else throw Error('QUALIFICATION_IMPORTED_RPC_FORBIDDEN');
      const text = JSON.stringify({ jsonrpc: '2.0', id: body.id, result }); expect(text.length < 4096); guard();
      return { ok: true, headers: { get: (name: string) => name === 'content-type' ? 'application/json' :
        name === 'content-length' ? String(text.length) : null }, text: async () => text } as unknown as Response;
    } });
    const controller = new NativeTransfers(authority, () => wrapped, { rpc });
    try {
      await check(`native imported ${registration.chainId} ${phase === 'create' ? 'sign and persist' : 'exact-byte restart retry'}`, async () => {
        if (phase === 'create') await controller.prepare(hd1.address, `0.000000000000000${111 * (i + 1)}`);
        else {
          const saved = await (await transfer.journal(guard)).load(); expect(saved?.phase === 'signed'); expectedRaw = saved.rawTransaction;
          await controller.recover(true);
        }
        guard(); const review = controller.getSnapshot().review;
        expect(review && review.retry === (phase === 'restart') && review.context.chainId === registration.chainId);
        await controller.confirm(review.id, { method: 'device' }); guard();
        expect(controller.getSnapshot().phase === (phase === 'create' ? 'unknown' : 'pending'));
        const saved = await (await transfer.journal(guard)).load(); guard();
        expect(saved && saved.rawTransaction === expectedRaw && saved.phase === (phase === 'create' ? 'signed' : 'submitted'));
        hashes.push(saved.hash);
      });
    } finally { controller.dispose(); }
  }
  await check('native imported private key reveal and clear', async () => {
    const raw = runtime.keyExport; expect(raw);
    const adapter = {
      isAuthenticationRefusal: (error: unknown) => raw.isAuthenticationRefusal(error),
      readSelected: (scope: Parameters<typeof raw.readSelected>[0], signal: AbortSignal, guard: () => void,
        authentication: import('../src/custody/privateAuthentication.ts').NativePrivateAuthenticationScope) =>
        raw.readSelected(scope, signal, guard, bindNativePrivateAuthentication(authentication, { assertCurrent: guard, isPromptActive: () => false })),
    };
    const flow = new HdKeyExportFlow(authority, () => adapter);
    try {
      const shown = await flow.begin(); const id = shown.id;
      expect(shown.accountId === imported.id && shown.address === ADDRESS && shown.privateKey === FIXTURE_KEY && flow.isCurrent(id));
      flow.cancel(); expect(!flow.isCurrent(id));
    } finally { flow.dispose(); }
  });
  const container = await readSignedRecordEvidence(storage);
  expect(retainedSignedEntries(container.entries, olderAddresses) === older);
  const retained = container.entries.filter(entry => entry.from === ADDRESS.toLowerCase());
  expect(container.version === 1 && retained.length === 3 && retained.every((entry, i) =>
    entry.signer.type === 'Imported' && entry.signer.id === imported.index && entry.chainId === CHAINS[i] &&
    entry.hash === hashes[i] && entry.phase === (phase === 'create' ? 'signed' : 'submitted')));
  expect(await storage.getWalletFingerprint() === fingerprint &&
    JSON.stringify([await storage.keyringStorage.get('vault'), await storage.keyringStorage.get('vault-keys')]) === pair);
  await authority.selectNetwork('ethereum', state().revision, catalogue().revision, () => {}); await manage(hd1.id);
  expect(state().account?.address === hd1.address && catalogue().active.accountId === hd1.id);
  expect(signatures === (phase === 'create' ? 3 : 0) && authorizations === (phase === 'create' ? 0 : 3) && broadcasts === 3);
  return Object.freeze({ nativeImportedVerified: true, importedAccountId: imported.id, importedAccountIndex: imported.index, importedAddress: ADDRESS,
    importedChainIds: CHAINS, importedTransferHashes: Object.freeze(hashes), importedJournalContainerVersion: 1,
    importedSignatures: signatures, importedAuthorizations: authorizations, importedInjectedBroadcasts: 3,
    importedRestoredFromJournal: phase === 'restart', importedKeyRevealVerified: true });
}
