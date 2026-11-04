import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { NativeAccountRequest } from '../src/custody/accounts.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { readSignedRecordEvidence } from './signed-record-evidence.ts';

type Check = <T>(name: string, operation: () => Promise<T>) => Promise<T>;
export type HdQualificationEvidence = Readonly<{
  address: string;
  transferHash: string;
  firstTransferHash: string;
  nativeSigningVerified: true;
  nativeHdAccountsVerified: true;
  selectedAccountId: 'hd:60:1';
  selectedAccountIndex: 1;
  journalContainerVersion: 1;
}>;

export function isHdQualificationReport(report: Record<string, unknown>): boolean {
  const fields = ['nativeHdAccountsVerified', 'selectedAccountId', 'selectedAccountIndex', 'firstTransferHash', 'journalContainerVersion'];
  if (report.status === 'failed') return fields.every((field) => !Object.hasOwn(report, field));
  return report.status === 'passed' && report.nativeHdAccountsVerified === true &&
    report.selectedAccountId === 'hd:60:1' && report.selectedAccountIndex === 1 && report.journalContainerVersion === 1 &&
    typeof report.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(report.address) &&
    (report.scenario !== 'import' || report.address === '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0') &&
    typeof report.firstTransferHash === 'string' && /^0x[0-9a-f]{64}$/.test(report.firstTransferHash) &&
    typeof report.transferHash === 'string' && /^0x[0-9a-f]{64}$/.test(report.transferHash) &&
    report.transferHash !== report.firstTransferHash;
}

export function matchesHdRestartEvidence(created: Record<string, unknown>, restored: Record<string, unknown>): boolean {
  return created.status === 'passed' && restored.status === 'passed' &&
    isHdQualificationReport(created) && isHdQualificationReport(restored) &&
    ['address', 'selectedAccountId', 'selectedAccountIndex', 'transferHash', 'firstTransferHash', 'journalContainerVersion']
      .every((field) => created[field] === restored[field]);
}

function requireEvidence(value: unknown): asserts value {
  if (!value) throw Error('QUALIFICATION_HD_ASSERTION_FAILED');
}

/** Runs only after the native crypto gate and authenticated seed backup. */
export async function qualifyNativeHdAccounts(options: Readonly<{
  phase: 'create' | 'restart';
  authority: NativeCustodyAuthority;
  runtime: KeyringRuntime;
  storage: Pick<OpenWalletStorage, 'signedRecords' | 'recovery' | 'getWalletFingerprint'>;
  password: string;
  expectedSecondAddress?: string;
  expectedRestartAddress?: string | null;
  check: Check;
}>): Promise<HdQualificationEvidence> {
  const { authority, runtime, storage, password, check } = options;
  if (options.phase === 'create') requireEvidence(
    typeof options.expectedSecondAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(options.expectedSecondAddress)
  );
  const { CustodyOperationError } = await import('../src/custody/authority.ts');
  const { Transaction } = await import('ethers/transaction');
  const transfer = runtime.transfers;
  requireEvidence(transfer && authority.supportsAccountManagement());
  const catalogue = () => {
    const value = authority.getCatalogue();
    requireEvidence(value);
    return value;
  };
  const first = catalogue().accounts.find((account) => account.index === 0);
  requireEvidence(first?.id === 'hd:60:0');
  const firstAddress = first.address;
  const selected = () => authority.getSnapshot().account?.address;
  const guardFor = (address: string) => {
    const revision = authority.getSnapshot().revision;
    return () => requireEvidence(authority.getSnapshot().phase === 'ready' &&
      authority.getSnapshot().revision === revision && authority.getSnapshot().account?.network === 'ethereum' && selected() === address);
  };
  const manage = (request: NativeAccountRequest) => authority.manageAccounts(
    request, authority.getSnapshot().revision, catalogue().revision
  );
  const assertRejected = async (request: NativeAccountRequest, code: string, locks: boolean) => {
    const before = authority.getSnapshot().revision;
    const beforeCatalogue = catalogue().revision;
    let rejected = false;
    try { await manage(request); }
    catch (error) { rejected = error instanceof CustodyOperationError && error.code === code; }
    requireEvidence(rejected);
    requireEvidence(authority.getSnapshot().phase === (locks ? 'locked' : 'ready'));
    if (!locks) requireEvidence(authority.getSnapshot().revision === before && catalogue().revision === beforeCatalogue);
  };
  const readSigned = async (address: string, index: number) => {
    const guard = guardFor(address);
    const journal = await transfer.journal(guard);
    const stored = await journal.load();
    requireEvidence(stored?.phase === 'attempted');
    const signed = Transaction.from(stored.rawTransaction);
    requireEvidence(signed.isSigned() && signed.from === address && signed.hash === stored.hash &&
      signed.chainId === 1n && signed.nonce === 0 && signed.value === 123n &&
      signed.gasLimit === 21000n && signed.to === '0x1111111111111111111111111111111111111111' &&
      signed.data === '0x' && signed.maxFeePerGas === 3n && signed.maxPriorityFeePerGas === 1n);
    // Inspect the canonical encrypted profile bundle as well as the authenticated
    // exact-byte view. Historical records for other senders remain in the bundle.
    const identity = await storage.recovery?.readIdentity();
    const row = await readSignedRecordEvidence(storage);
    const fingerprint = await storage.getWalletFingerprint();
    guard();
    const entry = row.entries.find((value) => value.hash === stored.hash);
    requireEvidence(row.version === 1 && row.entries.length >= 1 &&
      identity?.pairFingerprint === fingerprint && identity.walletBindingId === stored.scope.walletFingerprint &&
      entry?.phase === 'attempted' && entry.chainId === '1' && entry.from === address.toLowerCase() && entry.nonce === 0 &&
      entry.signer.id === index && entry.signer.type === 'HDAccount' && !row.raw?.includes(stored.rawTransaction));
    return stored.hash;
  };
  const sign = async (address: string, index: number) => {
    const signed = await transfer.sign({
      type: 2, from: address, to: '0x1111111111111111111111111111111111111111',
      chainId: '1', nonce: '0', value: '123', gasLimit: '21000', data: '0x',
      maxFeePerGas: '3', maxPriorityFeePerGas: '1',
    }, guardFor(address));
    const journal = await transfer.journal(guardFor(address));
    const stored = await journal.saveSigned(signed.rawTransaction);
    requireEvidence(stored.hash === signed.hash);
    await journal.transition(stored.hash, 'attempted');
    return readSigned(address, index);
  };

  let firstTransferHash: string;
  let address: string;
  let transferHash: string;
  if (options.phase === 'create') {
    firstTransferHash = await check('native first-account prepared signature and durable container', () => sign(firstAddress, 0));
    address = await check('native HD create select remove and restore', async () => {
      requireEvidence(catalogue().active.accountId === first.id && selected() === firstAddress);
      await manage({ kind: 'create', label: 'Qualification account 2', password });
      const second = catalogue().accounts.find((account) => account.index === 1);
      requireEvidence(second?.id === 'hd:60:1' && second.address !== firstAddress && selected() === second.address);
      if (options.expectedSecondAddress) requireEvidence(second.address === options.expectedSecondAddress);
      await assertRejected({ kind: 'remove', id: second.id, password }, 'ACCOUNT_NOT_REMOVABLE', false);
      await assertRejected({ kind: 'remove', id: first.id, password }, 'ACCOUNT_NOT_REMOVABLE', false);
      await manage({ kind: 'select', id: first.id });
      await manage({ kind: 'remove', id: second.id, password });
      requireEvidence(!catalogue().accounts.some((account) => account.id === second.id));
      requireEvidence(catalogue().removed.some((account) => account.id === second.id && account.index === 1));
      await manage({ kind: 'restore', index: 1, label: 'Qualification restored account 2', password });
      const restored = catalogue().accounts.find((account) => account.index === 1);
      requireEvidence(restored?.id === second.id && restored.address === second.address && selected() === second.address);
      requireEvidence(!catalogue().removed.some((account) => account.index === 1));
      return second.address;
    });
    transferHash = await check('native selected-HD prepared signature and durable container', () => sign(address, 1));
    await check('native account journal isolation and pending-removal refusal', async () => {
      await manage({ kind: 'select', id: first.id });
      requireEvidence(await readSigned(firstAddress, 0) === firstTransferHash);
      await assertRejected({ kind: 'remove', id: 'hd:60:1', password }, 'PENDING_TRANSFER', true);
      await authority.unlock(password);
      requireEvidence(catalogue().active.accountId === first.id && selected() === firstAddress);
      await manage({ kind: 'select', id: 'hd:60:1' });
      requireEvidence(await readSigned(address, 1) === transferHash);
    });
  } else {
    const second = catalogue().accounts.find((account) => account.index === 1);
    requireEvidence(second?.id === 'hd:60:1' && catalogue().active.accountId === second.id && selected() === second.address);
    address = second.address;
    requireEvidence(address === options.expectedRestartAddress && address !== firstAddress);
    if (options.expectedSecondAddress) requireEvidence(address === options.expectedSecondAddress);
    transferHash = await check('native selected-HD identity and journal after cold restart', () => readSigned(address, 1));
    firstTransferHash = await check('native per-account journals after cold restart', async () => {
      await manage({ kind: 'select', id: first.id });
      const hash = await readSigned(firstAddress, 0);
      await manage({ kind: 'select', id: 'hd:60:1' });
      requireEvidence(await readSigned(address, 1) === transferHash);
      return hash;
    });
  }
  requireEvidence(transferHash !== firstTransferHash && catalogue().active.accountId === 'hd:60:1' && selected() === address);
  return Object.freeze({ address, transferHash, firstTransferHash, nativeSigningVerified: true,
    nativeHdAccountsVerified: true, selectedAccountId: 'hd:60:1', selectedAccountIndex: 1, journalContainerVersion: 1 });
}
