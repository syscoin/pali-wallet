// Public synthetic recovery controls; never imported by production.
export const recoveryAudit = { created: 0, prepared: 0, committed: 0, disposed: 0 };
const holds = new Map<string, { promise: Promise<void>; resolve(): void }>();
export function holdRecovery(stage: 'prepare' | 'commit' | 'dispose') {
  let resolve!: () => void;
  holds.set(stage, { promise: new Promise<void>((yes) => { resolve = yes; }), resolve: () => resolve() });
}
export function releaseRecovery(stage: 'prepare' | 'commit' | 'dispose') { holds.get(stage)?.resolve(); holds.delete(stage); }
export async function recoveryGate(stage: 'prepare' | 'commit' | 'dispose') { await holds.get(stage)?.promise; }
