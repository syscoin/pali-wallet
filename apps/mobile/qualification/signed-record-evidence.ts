import { inspectEvmSignedBundle } from '../../../source/wallet/evmSignedRecords.ts';
import type { EvmSignedPhase } from '../../../source/wallet/evmSignedRecords.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import type { Erc20TransferIntent } from '../src/custody/transferIntent.ts';

type EvidenceEntry = Readonly<{
  hash: string; chainId: string; from: string; nonce: number; phase: EvmSignedPhase;
  signer: Readonly<{ id: number; type: string }>;
  metadata?: Readonly<{ intent?: Erc20TransferIntent }>;
}>;
/** Inspect the actual encrypted domain; raw transaction checks use the authenticated runtime view. */
export async function readSignedRecordEvidence(storage: Pick<OpenWalletStorage, 'signedRecords' | 'recovery'>) {
  const identity = await storage.recovery?.readIdentity();
  if (!identity?.root) throw Error('QUALIFICATION_SIGNED_IDENTITY_MISSING');
  const raw = await storage.signedRecords.read(identity.root.profileId);
  if (raw === undefined) return Object.freeze({ version: 1 as const, entries: [] as readonly EvidenceEntry[], raw });
  inspectEvmSignedBundle(raw, identity.root.profileId);
  const parsed = JSON.parse(raw) as { version: 1; entries: EvidenceEntry[] };
  return Object.freeze({ version: parsed.version, entries: Object.freeze(parsed.entries), raw });
}
export function retainedSignedEntries(entries: readonly EvidenceEntry[], addresses: readonly string[]): string {
  const wanted = new Set(addresses.map(address => address.toLowerCase()));
  return JSON.stringify(entries.filter(entry => wanted.has(entry.from)));
}
