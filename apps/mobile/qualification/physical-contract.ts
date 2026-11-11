/** Fixed, test-only identities. Never accept a caller-selected bundle identifier. */
export const PHYSICAL_BUNDLES = Object.freeze({
  import: 'com.paliwallet.qualification.physical.import',
  generate: 'com.paliwallet.qualification.physical.generate',
  full_slh: 'com.paliwallet.qualification.physical.slh',
});
export type PhysicalScenario = keyof typeof PHYSICAL_BUNDLES;
export type PhysicalBuild = Readonly<{
  version: 1;
  scenario: PhysicalScenario;
  bundleIdentifier: string;
  sourceRevision: string;
  lockfileSha256: string;
}>;
export type PhysicalLaunch = Readonly<{
  phase: 'create' | 'restart' | 'reset';
  scenario: PhysicalScenario;
  address: string | null;
  runId: string;
  physical: PhysicalBuild;
}>;

const invalid = (): never => {
  throw Error('PHYSICAL_QUALIFICATION_INPUT_INVALID');
};
export function physicalBuild(
  value: unknown,
  iosIdentifier: unknown,
  androidIdentifier: unknown
): PhysicalBuild {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !==
      'bundleIdentifier,lockfileSha256,scenario,sourceRevision,version' ||
    v.version !== 1 ||
    typeof v.scenario !== 'string' ||
    !Object.hasOwn(PHYSICAL_BUNDLES, v.scenario) ||
    v.bundleIdentifier !== PHYSICAL_BUNDLES[v.scenario as PhysicalScenario] ||
    iosIdentifier !== v.bundleIdentifier ||
    androidIdentifier !== 'com.paliwallet.qualification' ||
    typeof v.sourceRevision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(v.sourceRevision) ||
    typeof v.lockfileSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.lockfileSha256)
  )
    return invalid();
  return Object.freeze({ ...v }) as PhysicalBuild;
}

export function physicalLaunch(
  raw: unknown,
  build: PhysicalBuild
): PhysicalLaunch {
  physicalBuild(build, build.bundleIdentifier, 'com.paliwallet.qualification');
  if (typeof raw !== 'string' || raw.length > 2048) return invalid();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid();
  }
  const keys = [...url.searchParams.keys()];
  const phase = url.searchParams.get('phase');
  const scenario = url.searchParams.get('scenario');
  const address = url.searchParams.get('address');
  const runId = url.searchParams.get('runId');
  if (
    url.protocol !== 'pali-wallet-qualification:' ||
    url.hostname !== 'physical' ||
    !['', '/'].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    keys.some(
      (key) => !['phase', 'scenario', 'address', 'runId'].includes(key)
    ) ||
    new Set(keys).size !== keys.length ||
    !['create', 'restart', 'reset'].includes(phase ?? '') ||
    scenario !== build.scenario ||
    !runId ||
    !/^[0-9a-f]{32}$/.test(runId) ||
    (phase === 'restart'
      ? !address || !/^0x[0-9a-fA-F]{40}$/.test(address)
      : address !== null)
  )
    return invalid();
  return Object.freeze({
    phase,
    scenario,
    address,
    runId,
    physical: build,
  }) as PhysicalLaunch;
}

export function physicalReportFields(launch: PhysicalLaunch) {
  return Object.freeze({
    physicalRunId: launch.runId,
    physicalBundleIdentifier: launch.physical.bundleIdentifier,
    physicalSourceRevision: launch.physical.sourceRevision,
  });
}

/** This deletes one key in this dedicated fixture app's private Keychain group only.
 * The host must explicitly opt into reset, verify this signed app, receive the
 * nonce-bound acknowledgement, then uninstall/reinstall this fixture container.
 * No wallet runtime, filesystem deletion, caller-selected key or service exists.
 */
export async function resetPhysicalFixture(
  launch: PhysicalLaunch,
  ports: {
    deleteKey(): Promise<void>;
    readKey(): Promise<string | null>;
  }
): Promise<Readonly<Record<string, unknown>>> {
  physicalBuild(
    launch.physical,
    launch.physical.bundleIdentifier,
    'com.paliwallet.qualification'
  );
  if (
    launch.phase !== 'reset' ||
    launch.scenario !== launch.physical.scenario ||
    launch.address !== null ||
    !/^[0-9a-f]{32}$/.test(launch.runId)
  )
    return invalid();
  await ports.deleteKey();
  if ((await ports.readKey()) !== null)
    throw Error('PHYSICAL_FIXTURE_KEY_RESET_FAILED');
  return Object.freeze({
    version: 1,
    status: 'reset',
    keyDeleted: true,
    ...physicalReportFields(launch),
  });
}
