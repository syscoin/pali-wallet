import { signQualificationTransfer } from './authorized-transfer.ts';
import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { NativeAccountRequest } from '../src/custody/accounts.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { readSignedRecordEvidence, retainedSignedEntries } from './signed-record-evidence.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';

type Check = <T>(name: string, operation: () => Promise<T>) => Promise<T>;
const IMPORTED_FOURTH_ADDRESS = '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E';
const REPORT_FIELDS = Object.freeze([
  'nativeNevmVerified',
  'nevmAccountId',
  'nevmAccountIndex',
  'nevmAddress',
  'nevmTransferHash',
  'nevmEthereumTransferHash',
  'nevmChainId',
  'nevmJournalContainerVersion',
  'nevmRestoredFromJournal',
]);

export type NevmQualificationEvidence = Readonly<{
  nativeNevmVerified: true;
  nevmAccountId: 'hd:60:3';
  nevmAccountIndex: 3;
  nevmAddress: string;
  nevmTransferHash: string;
  nevmEthereumTransferHash: string;
  nevmChainId: '5700';
  nevmJournalContainerVersion: 1;
  nevmRestoredFromJournal: boolean;
}>;

/** Pure host validation; importing this module does not load the wallet SDK. */
export function isNevmQualificationReport(
  report: Record<string, unknown>
): boolean {
  if (report.status === 'failed')
    return REPORT_FIELDS.every((field) => !Object.hasOwn(report, field));
  const hashes = [
    report.nevmTransferHash,
    report.nevmEthereumTransferHash,
    report.transferHash,
    report.firstTransferHash,
    report.erc20TransferHash,
  ];
  return (
    report.status === 'passed' &&
    (report.phase === 'create' || report.phase === 'restart') &&
    (report.scenario === 'import' || report.scenario === 'generate') &&
    report.networkCalls === 0 &&
    report.nativeNevmVerified === true &&
    report.nevmAccountId === 'hd:60:3' &&
    report.nevmAccountIndex === 3 &&
    typeof report.nevmAddress === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(report.nevmAddress) &&
    !/^0x0{40}$/.test(report.nevmAddress) &&
    report.nevmAddress !== report.address &&
    report.nevmAddress !== report.erc20Address &&
    (report.scenario !== 'import' ||
      report.nevmAddress === IMPORTED_FOURTH_ADDRESS) &&
    hashes.every(
      (hash) => typeof hash === 'string' && /^0x[0-9a-f]{64}$/.test(hash)
    ) &&
    new Set(hashes).size === hashes.length &&
    report.nevmChainId === '5700' &&
    report.nevmJournalContainerVersion === 1 &&
    report.nevmRestoredFromJournal === (report.phase === 'restart')
  );
}

export function matchesNevmRestartEvidence(
  created: Record<string, unknown>,
  restored: Record<string, unknown>
): boolean {
  return (
    created.status === 'passed' &&
    restored.status === 'passed' &&
    created.phase === 'create' &&
    restored.phase === 'restart' &&
    created.scenario === restored.scenario &&
    isNevmQualificationReport(created) &&
    isNevmQualificationReport(restored) &&
    typeof created.fingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(created.fingerprint) &&
    [
      'fingerprint',
      'nevmAccountId',
      'nevmAccountIndex',
      'nevmAddress',
      'nevmTransferHash',
      'nevmEthereumTransferHash',
      'nevmChainId',
      'nevmJournalContainerVersion',
    ].every((field) => created[field] === restored[field])
  );
}

function expect(value: unknown): asserts value {
  if (!value) throw Error('QUALIFICATION_NEVM_ASSERTION_FAILED');
}

/** Public offline fixture, invoked only after native crypto/storage admission. */
export async function qualifyNativeNevmTransfer(
  options: Readonly<{
    phase: 'create' | 'restart';
    authority: NativeCustodyAuthority;
    runtime: KeyringRuntime;
    storage: Pick<OpenWalletStorage, 'signedRecords' | 'recovery' | 'getWalletFingerprint'>;
      expectedFourthAddress?: string;
    check: Check;
  }>
): Promise<NevmQualificationEvidence> {
  const { phase, authority, runtime, storage, check } = options;
  expect(phase === 'create' || phase === 'restart');
  if (options.expectedFourthAddress !== undefined)
    expect(
      typeof options.expectedFourthAddress === 'string' &&
        /^0x[0-9a-fA-F]{40}$/.test(options.expectedFourthAddress)
    );
  const [
    { Transaction },
    { getNativeNetwork },
  ] = await Promise.all([
    import('ethers/transaction'),
    import('../src/custody/networkContext.ts'),
  ]);
  const transfer = runtime.transfers;
  expect(transfer && authority.supportsAccountManagement());
  const current = () => authority.getSnapshot();
  const catalogue = () => {
    const value = authority.getCatalogue();
    expect(value);
    return value;
  };
  const manage = (request: NativeAccountRequest) =>
    authority.manageAccounts(request, current().revision, catalogue().revision);
  const selectNetwork = (id: 'ethereum' | 'syscoin-nevm-testnet') =>
    authority.selectNetwork(id, current().revision, catalogue().revision, () => {});
  const guardFor = (
    id: string,
    address: string,
    network: 'ethereum' | 'syscoin-nevm-testnet'
  ) => {
    const revision = current().revision;
    const catalogueRevision = catalogue().revision;
    return () =>
      expect(
        current().phase === 'ready' &&
          current().revision === revision &&
          current().account?.address === address &&
          current().account?.network === network &&
          catalogue().revision === catalogueRevision &&
          catalogue().active.accountId === id &&
          catalogue().active.networkId === network
      );
  };
  const second = catalogue().accounts.find((account) => account.index === 1);
  expect(second?.id === 'hd:60:1');
  const initialGuard = guardFor(second.id, second.address, 'ethereum');
  initialGuard();
  const fingerprint = await storage.getWalletFingerprint();
  initialGuard();
  const olderAddresses = [0, 1, 2].map((index) => {
    const older = catalogue().accounts.find((entry) => entry.id === `hd:60:${index}`);
    expect(older); return older.address;
  });
  const before = await readSignedRecordEvidence(storage); initialGuard();
  const olderRows = retainedSignedEntries(before.entries, olderAddresses);
  expect(olderAddresses.every((address) => before.entries.some((entry) => entry.from === address.toLowerCase())));
  if (phase === 'create') {
    expect(!catalogue().accounts.some((account) => account.index === 3));
    await check('native NEVM dedicated HD3 account', () =>
      manage({
        kind: 'create',
        label: 'Qualification NEVM account',
      })
    );
  } else
    await check('native NEVM select retained HD3 after cold restart', () =>
      manage({ kind: 'select', id: 'hd:60:3' })
    );
  const account = catalogue().accounts.find((entry) => entry.index === 3);
  expect(
    account?.id === 'hd:60:3' &&
      catalogue().active.accountId === account.id &&
      current().account?.address === account.address &&
      current().account?.network === 'ethereum' &&
      catalogue().accounts.filter((entry) => entry.address === account.address)
        .length === 1
  );
  if (options.expectedFourthAddress)
    expect(account.address === options.expectedFourthAddress);
  const address = account.address;
  const recipient = '0x1111111111111111111111111111111111111111';
  const readSigned = async (
    network: 'ethereum' | 'syscoin-nevm-testnet',
    value: string
  ) => {
    const guard = guardFor(account.id, address, network);
    guard();
    const journal = await transfer.journal(guard);
    const stored = await journal.load();
    guard();
    const registration = getNativeNetwork(network);
    expect(
      stored?.phase === 'attempted' &&
        stored.version === 1 &&
        stored.nonce === 0 &&
        stored.scope.address === address &&
        stored.scope.walletFingerprint === (await storage.recovery?.readIdentity())?.walletBindingId &&
        stored.scope.chainId === registration.chainId &&
        stored.intent === undefined
    );
    const signed = Transaction.from(stored.rawTransaction);
    expect(
      signed.isSigned() &&
        signed.type === 2 &&
        signed.from === address &&
        signed.hash === stored.hash &&
        signed.serialized === stored.rawTransaction &&
        signed.chainId === BigInt(registration.chainId) &&
        signed.nonce === 0 &&
        signed.value === BigInt(value) &&
        signed.gasLimit === 21000n &&
        signed.to === recipient &&
        signed.data === '0x' &&
        signed.maxFeePerGas === 3n &&
        signed.maxPriorityFeePerGas === 1n &&
        signed.accessList?.length === 0
    );
    const row = await readSignedRecordEvidence(storage);
    guard();
    const entry = row.entries.find((item) => item.hash === stored.hash);
    expect(
      row.version === 1 &&
        entry?.phase === 'attempted' &&
        entry.nonce === 0 &&
        entry.hash === stored.hash &&
        entry.from === address.toLowerCase() &&
        entry.chainId === registration.chainId &&
        entry.signer.id === 3 &&
        entry.signer.type === 'HDAccount' &&
        entry.metadata?.intent === undefined &&
        !row.raw?.includes(stored.rawTransaction)
    );
    return stored;
  };
  const sign = async (
    network: 'ethereum' | 'syscoin-nevm-testnet',
    value: string
  ) => {
    const guard = guardFor(account.id, address, network);
    guard();
    const signed = await signQualificationTransfer(transfer,
      {
        type: 2, accessList: [],
        from: address,
        to: recipient,
        chainId: getNativeNetwork(network).chainId,
        nonce: '0',
        value,
        gasLimit: '21000',
        data: '0x',
        maxFeePerGas: '3',
        maxPriorityFeePerGas: '1',
      },
      { assertCurrent: guard, signal: new AbortController().signal }
    );
    guard();
    const journal = await transfer.journal(guard);
    const stored = await journal.saveSigned(signed.rawTransaction);
    guard();
    expect(stored.hash === signed.hash);
    await journal.transition(stored.hash, 'attempted');
    guard();
    return readSigned(network, value);
  };
  const ethereum = await check(
    phase === 'create'
      ? 'native NEVM companion Ethereum signature and journal'
      : 'native NEVM companion Ethereum journal after cold restart',
    () =>
      phase === 'create'
        ? sign('ethereum', '456')
        : readSigned('ethereum', '456')
  );
  await selectNetwork('syscoin-nevm-testnet');
  const nevm = await check(
    phase === 'create'
      ? 'native NEVM chain 5700 signature and journal'
      : 'native NEVM chain 5700 journal after cold restart',
    () =>
      phase === 'create'
        ? sign('syscoin-nevm-testnet', '789')
        : readSigned('syscoin-nevm-testnet', '789')
  );
  expect(
    ethereum.hash !== nevm.hash &&
      ethereum.rawTransaction !== nevm.rawTransaction
  );
  const nevmGuard = guardFor(account.id, address, 'syscoin-nevm-testnet');
  const row = await readSignedRecordEvidence(storage);
  nevmGuard();
  const entries = row.entries.filter((entry) => entry.from === address.toLowerCase());
  expect(entries.length === 2 && entries[0]?.hash === ethereum.hash && entries[1]?.hash === nevm.hash);
  await selectNetwork('ethereum');
  expect(
    (await readSigned('ethereum', '456')).rawTransaction ===
      ethereum.rawTransaction
  );
  await check(
    'native NEVM preserves prior journals and restores HD1 Ethereum',
    async () => {
      const guard = guardFor(account.id, address, 'ethereum');
      const retained = await readSignedRecordEvidence(storage);
      guard();
      expect(retainedSignedEntries(retained.entries, olderAddresses) === olderRows);
      expect((await storage.getWalletFingerprint()) === fingerprint);
      guard();
      await manage({ kind: 'select', id: second.id });
      guardFor(second.id, second.address, 'ethereum')();
    }
  );
  return Object.freeze({
    nativeNevmVerified: true,
    nevmAccountId: 'hd:60:3',
    nevmAccountIndex: 3,
    nevmAddress: address,
    nevmTransferHash: nevm.hash,
    nevmEthereumTransferHash: ethereum.hash,
    nevmChainId: '5700',
    nevmJournalContainerVersion: 1,
    nevmRestoredFromJournal: phase === 'restart',
  });
}
