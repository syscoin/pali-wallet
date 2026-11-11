import { readSignedRecordEvidence } from './signed-record-evidence.ts';
import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { HdKeyExportPresentation } from '../src/custody/hdKeyExport.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { bindNativePrivateAuthentication } from '../src/custody/privateAuthentication.ts';

export type HdKeyRevealEvidence = Readonly<{ nativeHdKeyRevealVerified: true }>;

export function isHdKeyRevealQualificationReport(report: Record<string, unknown>): boolean {
  if (report.status === 'failed') return !Object.hasOwn(report, 'nativeHdKeyRevealVerified');
  return report.status === 'passed' && report.nativeHdKeyRevealVerified === true &&
    (report.phase === 'create' || report.phase === 'restart') &&
    report.selectedAccountId === 'hd:60:1' && report.selectedAccountIndex === 1 &&
    typeof report.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(report.address);
}

export function matchesHdKeyRevealRestartEvidence(created: Record<string, unknown>, restored: Record<string, unknown>): boolean {
  return created.status === 'passed' && restored.status === 'passed' &&
    created.phase === 'create' && restored.phase === 'restart' &&
    isHdKeyRevealQualificationReport(created) && isHdKeyRevealQualificationReport(restored) &&
    ['address', 'selectedAccountId', 'selectedAccountIndex'].every((field) => created[field] === restored[field]);
}

function requireEvidence(value: unknown): asserts value {
  if (!value) throw Error('QUALIFICATION_HD_KEY_REVEAL_FAILED');
}

/** Offline fixture only. No key, seed or key hash is returned or reported. */
export async function qualifyNativeHdKeyReveal(options: Readonly<{
  authority: NativeCustodyAuthority;
  runtime: KeyringRuntime;
  storage: Pick<OpenWalletStorage, 'keyringStorage' | 'signedRecords' | 'recovery' | 'getWalletFingerprint'>;
  expectedAddress: string;
  check: <T>(name: string, operation: () => Promise<T>) => Promise<T>;
}>): Promise<HdKeyRevealEvidence> {
  const { authority, runtime, storage, expectedAddress, check } = options;
  const [{ HdKeyExportFlow }, { computeAddress }] = await Promise.all([
    import('../src/custody/hdKeyExport.ts'), import('ethers/transaction'),
  ]);
  const captured = authority.getSnapshot();
  const catalogue = authority.getCatalogue();
  const selected = catalogue?.accounts.find((account) => account.id === catalogue.active.accountId);
  requireEvidence(captured.phase === 'ready' && captured.backup === 'confirmed' &&
    selected?.id === 'hd:60:1' && selected.index === 1 && selected.type === 'HDAccount' &&
    captured.account?.address === expectedAddress && selected.address === expectedAddress &&
    /^0x[0-9a-fA-F]{40}$/.test(expectedAddress));
  const catalogueBefore = JSON.stringify(catalogue);
  const current = () => {
    const now = authority.getSnapshot();
    requireEvidence(now.phase === 'ready' && now.backup === 'confirmed' && now.revision === captured.revision &&
      now.account?.address === expectedAddress && now.account.network === captured.account?.network &&
      JSON.stringify(authority.getCatalogue()) === catalogueBefore);
  };
  const journals = async () => (await readSignedRecordEvidence(storage)).raw;
  const raw = runtime.keyExport;
  requireEvidence(raw);
  const adapter = {
    isAuthenticationRefusal: (error: unknown) => raw.isAuthenticationRefusal(error),
    readSelected: (scope: Parameters<typeof raw.readSelected>[0], signal: AbortSignal, guard: () => void,
      authentication: import('../src/custody/privateAuthentication.ts').NativePrivateAuthenticationScope) =>
      raw.readSelected(scope, signal, guard, bindNativePrivateAuthentication(authentication, { assertCurrent: guard, isPromptActive: () => false })),
  };
  const flow = new HdKeyExportFlow(authority, () => adapter);
  let presentation: HdKeyExportPresentation | undefined;
  try {
    await check('native selected-HD private key reveal', async () => {
      current();
      const before = await journals();
      const fingerprint = await storage.getWalletFingerprint();
      current();
      presentation = await flow.begin();
      current();
      requireEvidence(presentation.accountId === 'hd:60:1' && presentation.address === expectedAddress &&
        flow.isCurrent(presentation.id) && computeAddress(presentation.privateKey) === expectedAddress);
      const id = presentation.id;
      flow.cancel();
      presentation = undefined;
      requireEvidence(!flow.isCurrent(id));
      requireEvidence(JSON.stringify(await journals()) === JSON.stringify(before) &&
        await storage.getWalletFingerprint() === fingerprint);
      current();
    });
    return Object.freeze({ nativeHdKeyRevealVerified: true });
  } catch {
    throw Error('QUALIFICATION_HD_KEY_REVEAL_FAILED');
  } finally {
    presentation = undefined;
    flow.cancel();
    flow.dispose();
  }
}
