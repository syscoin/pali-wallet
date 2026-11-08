import { httpLaunch, type HttpLaunch } from './http-contract.ts';
import { publicPoolLaunch, type PublicPoolLaunch } from './public-pool-contract.ts';

export type QualificationPhase = 'create' | 'restart';
export type QualificationScenario = 'import' | 'generate';

/** This parser is confined to the dedicated public-fixture binary. */
export function assertQualificationBuild(iosIdentifier: unknown, androidIdentifier: unknown): void {
  if (iosIdentifier !== 'com.paliwallet.qualification' || androidIdentifier !== 'com.paliwallet.qualification')
    throw Error('QUALIFICATION_BUILD_IDENTIFIER_REQUIRED');
}

export function parseQualificationLaunch(raw: unknown): {
  phase: QualificationPhase;
  scenario: QualificationScenario;
  address: string | null;
  http?: HttpLaunch;
  publicPool?: PublicPoolLaunch;
  privateProof?: Readonly<{ token: string }>;
} {
  if (typeof raw !== 'string' || raw.length > 2048) throw Error('QUALIFICATION_LINK_INVALID');
  let url: URL;
  try { url = new URL(raw); } catch { throw Error('QUALIFICATION_LINK_INVALID'); }
  const keys = [...url.searchParams.keys()];
  const poolKeys = ['poolSnapshotPort', 'poolAnchorPort', 'poolToken'] as const;
  const phase = url.searchParams.get('phase');
  const scenario = url.searchParams.get('scenario');
  const address = url.searchParams.get('address');
  if (url.protocol !== 'pali-wallet-qualification:' || url.hostname !== 'run' ||
    !['', '/'].includes(url.pathname) || url.username || url.password || url.port || url.hash ||
    keys.some((key) => !['phase', 'scenario', 'address', 'httpPort', 'httpToken', 'proofToken', ...poolKeys].includes(key)) || new Set(keys).size !== keys.length ||
    !['create', 'restart'].includes(phase ?? '') || !['import', 'generate'].includes(scenario ?? '') ||
    (phase === 'create' ? address !== null : typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)))
    throw Error('QUALIFICATION_LINK_INVALID');
  const http = url.searchParams.has('httpPort') || url.searchParams.has('httpToken')
    ? httpLaunch(url.searchParams.get('httpPort'), url.searchParams.get('httpToken')) : undefined;
  const pool = poolKeys.some((key) => url.searchParams.has(key));
  if (pool && (http || phase !== 'create' || scenario !== 'import')) throw Error('QUALIFICATION_LINK_INVALID');
  const publicPool = pool ? publicPoolLaunch(url.searchParams.get('poolSnapshotPort'),
    url.searchParams.get('poolAnchorPort'), url.searchParams.get('poolToken')) : undefined;
  const proofToken = url.searchParams.get('proofToken');
  if (proofToken !== null && (!/^[0-9a-f]{32}$/.test(proofToken) || http || pool || phase !== 'create' || scenario !== 'import'))
    throw Error('QUALIFICATION_LINK_INVALID');
  return { phase: phase as QualificationPhase, scenario: scenario as QualificationScenario, address, ...(http ? { http } : {}), ...(publicPool ? { publicPool } : {}), ...(proofToken ? { privateProof: Object.freeze({ token: proofToken }) } : {}) };
}
