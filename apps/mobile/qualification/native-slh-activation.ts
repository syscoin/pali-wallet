import type { KeyringRuntime, NativeSlhDsaAccount } from '../src/custody/keyringRuntime.ts';
import type { NativeSlhPublicState } from '../src/smartAccount/slhDsaRuntime.ts';
import { getSLHDSAKeyId, SLH_DSA_PARAMETER_SET } from '../../../source/utils/slhDsa/constants.ts';
import { parseNativeAccountId } from '../src/custody/accountIdentity.ts';

/** Public disposable fixture only. It must never receive funds. */
export const SLH_ACTIVATION_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export type SlhActivationCounters = Readonly<{ stages: number; secretReads: number; nativeOpens: number; nativeActive: number }>;
export type SlhActivationEvidence = Readonly<{
  version: 1;
  authorizationMode: 'native-os';
  phase: 'create' | 'restart';
  publicChain: 'offline-undeployed-fixture';
  keyId: string;
  accountId: string;
  signatureCount: 0;
  nativeSetupComplete: true;
  privateRuntimeRetired: true;
  publicReopenWithoutSecret: boolean;
  counters: SlhActivationCounters;
}>;
function fail(): never { throw Error('SLH_ACTIVATION_QUALIFICATION_FAILED'); }
export function readSlhActivationEvidence(value: unknown): SlhActivationEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const row = value as Record<string, unknown>;
  const keys = ['version', 'authorizationMode', 'phase', 'publicChain', 'keyId', 'accountId', 'signatureCount',
    'nativeSetupComplete', 'privateRuntimeRetired', 'publicReopenWithoutSecret', 'counters'];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) ||
      row.version !== 1 || row.authorizationMode !== 'native-os' || !['create', 'restart'].includes(String(row.phase)) ||
      row.publicChain !== 'offline-undeployed-fixture' || row.signatureCount !== 0 || row.nativeSetupComplete !== true ||
      row.privateRuntimeRetired !== true || row.publicReopenWithoutSecret !== (row.phase === 'restart') ||
      typeof row.keyId !== 'string' || typeof row.accountId !== 'string') fail();
  const fields = row.keyId.split(':');
  if (fields.length !== 3 || fields[0] !== SLH_DSA_PARAMETER_SET || fields.slice(1).some(field => !/^0x[0-9a-f]{64}$/.test(field))) fail();
  try { if (parseNativeAccountId(row.accountId).type !== 'SmartAccount') fail(); } catch { fail(); }
  const counters = row.counters as Record<string, unknown> | null;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters) ||
      Object.keys(counters).sort().join(',') !== 'nativeActive,nativeOpens,secretReads,stages' ||
      counters.stages !== (row.phase === 'create' ? 1 : 0) || counters.secretReads !== (row.phase === 'create' ? 2 : 0) ||
      counters.nativeOpens !== (row.phase === 'create' ? 1 : 0) || counters.nativeActive !== 0) fail();
  return Object.freeze({ ...row, counters: Object.freeze({ ...counters }) }) as SlhActivationEvidence;
}

/** Exercise the production runtime facade; never install a validator or sign using fabricated metadata. */
export async function qualifyNativeSlhActivation(input: Readonly<{
  phase: 'create' | 'restart';
  previous: SlhActivationEvidence | null;
  signal: AbortSignal;
  open(): Promise<KeyringRuntime>;
  counts(): SlhActivationCounters;
  assertCurrent(): void;
  observe(stage: 'open' | 'enroll' | 'create-smart' | 'prepare' | 'public-reopen' | 'complete'): void;
  progress?: Parameters<NativeSlhDsaAccount['prepareFresh']>[0];
}>): Promise<SlhActivationEvidence> {
  const check = () => { if (input.signal.aborted) fail(); input.assertCurrent(); };
  if (!['create', 'restart'].includes(input.phase) || (input.phase === 'create' ? input.previous !== null : input.previous?.phase !== 'create')) fail();
  const previous = input.phase === 'restart' ? readSlhActivationEvidence(input.previous) : null;
  let runtime: KeyringRuntime | null = null;
  try {
    check(); input.observe('open'); runtime = await input.open(); check();
    let prepared: NativeSlhPublicState, accountId: string;
    if (input.phase === 'create') {
      if ((await runtime.storage.readState()).presence !== 'empty') fail();
      input.observe('enroll'); await runtime.session.importWallet(SLH_ACTIVATION_PHRASE); check();
      // The phrase is the fixed public fixture above; no seed reveal is needed.
      await runtime.backup.confirm(await runtime.backup.fingerprint()); check();
      const accounts = runtime.accounts, before = accounts?.getSnapshot();
      if (!accounts || !before) fail();
      input.observe('create-smart');
      await accounts.reserve({ kind: 'create-smart', label: 'Native SLH activation fixture' }, before.revision).execute(check); check();
      const selected = accounts.getSnapshot();
      if (!selected || selected.active.accountId === before.active.accountId) fail();
      accountId = selected.active.accountId;
      const account = selected.accounts.find(row => row.id === accountId);
      if (account?.type !== 'SmartAccount' || account.smartAccount?.isDeployed !== false) fail();
      const facade = await runtime.openSlhDsaAccount(check, input.signal, null); check();
      if (facade.installedKeys.length !== 0) fail();
      input.observe('prepare'); prepared = await facade.prepareFresh(value => input.progress?.(value)); check();
      const rows = await facade.readPrepared(); check();
      if (rows.length !== 1 || JSON.stringify(rows[0]) !== JSON.stringify(prepared)) fail();
      const counts = input.counts();
      if (counts.stages !== 1 || counts.secretReads !== 2 || counts.nativeOpens !== 1 || counts.nativeActive !== 0) fail();
    } else {
      if (!previous) fail();
      if ((await runtime.storage.readState()).presence !== 'existing') fail();
      input.observe('public-reopen');
      if (!(await runtime.session.unlock()).authenticated) fail(); check();
      const selected = runtime.accounts?.getSnapshot();
      if (!selected || selected.active.accountId !== previous.accountId) fail();
      accountId = previous.accountId;
      const facade = await runtime.openSlhDsaAccount(check, input.signal, null); check();
      if (facade.installedKeys.length !== 0) fail();
      const rows = await facade.readPrepared(); check();
      if (rows.length !== 1 || rows[0]?.keyId !== previous.keyId) fail();
      prepared = rows[0];
      const counts = input.counts();
      if (counts.stages !== 0 || counts.secretReads !== 0 || counts.nativeOpens !== 0 || counts.nativeActive !== 0) fail();
    }
    if (prepared.signatureCount !== 0 || prepared.parameterSet !== SLH_DSA_PARAMETER_SET || prepared.keyId !== getSLHDSAKeyId(prepared)) fail();
    await runtime.storage.close(); runtime = null; check();
    if (input.counts().nativeActive !== 0) fail();
    input.observe('complete');
    return readSlhActivationEvidence({ version: 1, authorizationMode: 'native-os', phase: input.phase,
      publicChain: 'offline-undeployed-fixture', keyId: prepared.keyId, accountId, signatureCount: 0,
      nativeSetupComplete: true, privateRuntimeRetired: true, publicReopenWithoutSecret: input.phase === 'restart', counters: input.counts() });
  } finally { await runtime?.storage.close(); }
}
