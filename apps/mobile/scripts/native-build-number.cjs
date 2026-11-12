const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const COUNTER_REF = 'refs/heads/pali-mobile-build-counter';
const MAX_BUILD_NUMBER = 2100000000;
const MAX_ATTEMPTS = 5;
const OBJECT_ID = /^[0-9a-f]{40}$/;
const STATE_KEYS = ['schemaVersion', 'buildNumber', 'requestId', 'sourceRevision', 'purpose', 'allocatedAt'];

function failure(code) {
  const error = new Error(`Native build number reservation failed (${code}).`);
  error.code = code;
  return error;
}

function parseBuildNumber(value) {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_BUILD_NUMBER)
    throw failure('INVALID_BUILD_NUMBER');
  return value;
}

function createGit(cwd) {
  return (args, input = '') => new Promise(resolve => {
    // Capture and discard Git diagnostics: credential helpers/remote URLs must
    // never become public allocator errors or build receipts.
    const child = execFile('git', args, {
      cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    }, (error, stdout) => resolve({ status: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function checked(git, args, input) {
  let result;
  try { result = await git(args, input); } catch { throw failure('GIT_UNAVAILABLE'); }
  if (result.status !== 0 || typeof result.stdout !== 'string') throw failure('GIT_UNAVAILABLE');
  return result.stdout;
}

async function origin(git, push = false) {
  const output = await checked(git, ['remote', 'get-url', ...(push ? ['--push'] : []), '--all', 'origin']);
  const urls = output.split('\n').filter(Boolean);
  if (urls.length !== 1 || !/^(?:https:\/\/github\.com\/syscoin\/pali-wallet(?:\.git)?|git@github\.com:syscoin\/pali-wallet(?:\.git)?)$/.test(urls[0]))
    throw failure('INVALID_ORIGIN');
  return urls[0];
}

async function source(git, purpose) {
  const revision = (await checked(git, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  if (!OBJECT_ID.test(revision)) throw failure('INVALID_SOURCE');
  const dirty = (await checked(git, ['status', '--porcelain=v1', '--untracked-files=all'])).length > 0;
  if (purpose === 'store' && dirty) throw failure('DIRTY_STORE_SOURCE');
  return { revision, dirty };
}

function parseState(text) {
  let state;
  try { state = JSON.parse(text); } catch { throw failure('INVALID_COUNTER_STATE'); }
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      Object.keys(state).length !== STATE_KEYS.length || STATE_KEYS.some(key => !Object.hasOwn(state, key)) ||
      state.schemaVersion !== 1 || typeof state.buildNumber !== 'number' ||
      typeof state.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(state.requestId) ||
      !OBJECT_ID.test(state.sourceRevision) || !['qa', 'store'].includes(state.purpose) ||
      typeof state.allocatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(state.allocatedAt))
    throw failure('INVALID_COUNTER_STATE');
  try {
    if (parseBuildNumber(state.buildNumber) < 2 || new Date(state.allocatedAt).toISOString() !== state.allocatedAt)
      throw failure('INVALID_COUNTER_STATE');
  } catch { throw failure('INVALID_COUNTER_STATE'); }
  return state;
}

async function readCounter(git, remote) {
  let result;
  try { result = await git(['ls-remote', '--exit-code', '--refs', remote, COUNTER_REF]); }
  catch { throw failure('COUNTER_UNAVAILABLE'); }
  if (result.status === 2 && result.stdout === '') return null;
  const match = typeof result.stdout === 'string' && result.stdout.match(new RegExp(`^([0-9a-f]{40})\\t${COUNTER_REF}\\n$`));
  if (result.status !== 0 || !match) throw failure('COUNTER_UNAVAILABLE');
  const revision = match[1];
  // Fetch objects without changing a checkout, local branch or FETCH_HEAD.
  await checked(git, ['fetch', '--no-tags', '--no-write-fetch-head', remote, COUNTER_REF]);
  const tree = await checked(git, ['ls-tree', '--full-tree', revision]);
  const entry = tree.match(/^100644 blob ([0-9a-f]{40})\tstate\.json\n$/);
  if (!entry) throw failure('INVALID_COUNTER_TREE');
  return { revision, state: parseState(await checked(git, ['cat-file', 'blob', entry[1]])) };
}

async function isAncestor(git, ancestor, descendant) {
  let result;
  try { result = await git(['merge-base', '--is-ancestor', ancestor, descendant]); }
  catch { throw failure('COUNTER_VERIFICATION_FAILED'); }
  if (result.status !== 0 && result.status !== 1) throw failure('COUNTER_VERIFICATION_FAILED');
  return result.status === 0;
}

async function commitState(git, state, parent) {
  const blob = (await checked(git, ['hash-object', '-w', '--stdin'], `${JSON.stringify(state)}\n`)).trim();
  if (!OBJECT_ID.test(blob)) throw failure('INVALID_COUNTER_OBJECT');
  const tree = (await checked(git, ['mktree'], `100644 blob ${blob}\tstate.json\n`)).trim();
  if (!OBJECT_ID.test(tree)) throw failure('INVALID_COUNTER_OBJECT');
  const revision = (await checked(git, [
    '-c', 'user.name=Pali Mobile Build Counter', '-c', 'user.email=build-counter@paliwallet.com',
    '-c', 'commit.gpgsign=false', 'commit-tree', tree, ...(parent ? ['-p', parent] : []),
  ], `Reserve native build ${state.buildNumber}\n\nRequest: ${state.requestId}\n`)).trim();
  if (!OBJECT_ID.test(revision)) throw failure('INVALID_COUNTER_OBJECT');
  return revision;
}

async function reserve(options, dependencies) {
  const { cwd, purpose } = options ?? {};
  if (typeof cwd !== 'string' || !cwd || !['qa', 'store'].includes(purpose)) throw failure('INVALID_REQUEST');
  const git = dependencies.git ?? createGit(cwd);
  const fetchRemote = await origin(git), pushRemote = await origin(git, true);
  const initial = await source(git, purpose);
  const requestId = (dependencies.requestId ?? randomUUID)();
  const allocatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  let previous = await readCounter(git, fetchRemote);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const buildNumber = parseBuildNumber((previous?.state.buildNumber ?? 1) + 1);
    const state = { schemaVersion: 1, buildNumber, requestId, sourceRevision: initial.revision, purpose, allocatedAt };
    // Validate injected clocks/identities with the same schema as remote data.
    parseState(JSON.stringify(state));
    const allocationRevision = await commitState(git, state, previous?.revision);
    const currentSource = await source(git, purpose);
    if (currentSource.revision !== initial.revision) throw failure('SOURCE_CHANGED');
    let pushed;
    try { pushed = await git(['push', '--porcelain', pushRemote, `${allocationRevision}:${COUNTER_REF}`]); }
    catch { pushed = { status: -1 }; }
    // Even a failed/ambiguous push may have reserved a number. Only return it
    // after proving this exact owned commit is in the remote counter history.
    let current;
    try { current = await readCounter(git, fetchRemote); }
    catch { throw failure('COUNTER_VERIFICATION_FAILED'); }
    if (current && await isAncestor(git, allocationRevision, current.revision)) {
      return Object.freeze({ ...state, allocationRevision, sourceDirty: initial.dirty || currentSource.dirty });
    }
    if (pushed.status === 0 || !current || current.revision === previous?.revision ||
        (previous && !(await isAncestor(git, previous.revision, current.revision))) ||
        current.state.buildNumber <= (previous?.state.buildNumber ?? 1))
      throw failure('COUNTER_RESERVATION_FAILED');
    // A competing, verified fast-forward won the compare-and-swap. Retry from
    // its state; never force-push or reset a malformed/missing counter.
    previous = current;
  }
  throw failure('COUNTER_CONTENTION');
}

async function reserveBuildNumber(options) {
  return reserve(options, {});
}

async function assertSource({ cwd, receipt } = {}, dependencies = {}) {
  if (typeof cwd !== 'string' || !cwd || !receipt || !['qa', 'store'].includes(receipt.purpose) ||
      !OBJECT_ID.test(receipt.sourceRevision)) throw failure('INVALID_REQUEST');
  const current = await source(dependencies.git ?? createGit(cwd), receipt.purpose);
  if (current.revision !== receipt.sourceRevision) throw failure('SOURCE_CHANGED');
}

async function assertBuildSource(options) {
  await assertSource(options);
}

module.exports = { parseBuildNumber, reserveBuildNumber, assertBuildSource,
  _testing: Object.freeze({ reserve, assertSource, createGit, COUNTER_REF, MAX_BUILD_NUMBER, MAX_ATTEMPTS }) };
