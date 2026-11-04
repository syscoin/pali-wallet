import { boundedResponseText, ResponseSizeLimitError } from '../src/platformRpc.ts';
import { HTTP_CASES, type HttpBuild, type HttpCase, type HttpLaunch, type HttpReport } from './http-contract.ts';

type FetchPort = (url: string, init: RequestInit) => Promise<Response>;
function assert(condition: unknown): asserts condition { if (!condition) throw Error('HTTP_QUALIFICATION_FAILED'); }
const TIMEOUT = 8_000;
export class HttpQualificationError extends Error {
  readonly failedCase: HttpCase;
  constructor(failedCase: HttpCase) { super('HTTP_QUALIFICATION_FAILED'); this.failedCase = failedCase; }
}

/** Native streaming boundaries are arbitrary; consume exactly the public prefix. */
async function readStart(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<void> {
  const expected = [115, 116, 97, 114, 116];
  let offset = 0;
  for (let reads = 0; offset < expected.length && reads < 16; reads++) {
    const chunk = await reader.read();
    assert(!signal.aborted && !chunk.done && chunk.value instanceof Uint8Array && chunk.value.byteLength <= expected.length - offset);
    for (const byte of chunk.value) assert(byte === expected[offset++]);
  }
  assert(offset === expected.length);
}

/** Uses the production adapter and real Expo cookie jar, never global fetch. */
export async function qualifyNativeHttp(options: Readonly<{
  launch: HttpLaunch; build: HttpBuild; walletFetch: FetchPort; cookieFetch: FetchPort;
  phase: HttpReport['phase']; scenario: HttpReport['scenario']; platform: HttpReport['platform'];
  sessionId: string; networkCalls: () => number;
}>): Promise<HttpReport> {
  const { launch, walletFetch, cookieFetch } = options;
  const url = (route: string) => `http://127.0.0.1:${launch.port}/${launch.token}/${route}?q=exact`;
  const owned = async <T>(fn: (signal: AbortSignal, abort: () => void) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('HTTP_QUALIFICATION_TIMEOUT')); }, TIMEOUT);
    });
    try { return await Promise.race([fn(controller.signal, () => controller.abort()), deadline]); }
    finally { controller.abort(); clearTimeout(timer); }
  };
  const query = (route: string, fetcher = walletFetch, credentials: RequestCredentials = 'omit') => owned(async (signal) => {
    const response = await fetcher(url(route), { method: 'GET', signal, credentials, redirect: 'error', cache: 'no-store' });
    assert(response.ok && response.url === url(route) && !response.redirected);
    const text = await boundedResponseText(response, signal, 1024);
    assert(text === '{"ok":true}');
  });
  let currentCase: HttpCase = 'exact-get-url';
  try {
  await query('exact');
  currentCase = 'redirect-refused';
  await owned(async (signal) => {
    let rejected = false;
    try { await walletFetch(url('redirect'), { method: 'GET', signal, redirect: 'error', credentials: 'omit' }); }
    catch { rejected = true; }
    assert(rejected && !signal.aborted);
  });
  // Positive control seeds a PUBLIC cookie through the same Expo native jar.
  // Production walletFetch always omits cookies and is used for the actual test.
  currentCase = 'seeded-cookie-omitted';
  await query('seed', cookieFetch, 'include');
  try {
    await query('cookie-present', cookieFetch, 'include');
    await query('cookie-omitted');
  } finally { await query('clear-cookie', cookieFetch, 'include'); }
  currentCase = 'abort-before-headers';
  await owned(async (signal, abort) => {
    const rejected = walletFetch(url('before'), { method: 'GET', signal }).then(() => false, () => true);
    await query('before-ready');
    assert(!signal.aborted);
    abort();
    assert(await rejected);
    await query('before-closed');
  });
  currentCase = 'abort-stream';
  await owned(async (signal, abort) => {
    const response = await walletFetch(url('body'), { method: 'GET', signal });
    const reader = response.body?.getReader();
    assert(response.ok && reader);
    try {
      await readStart(reader!, signal);
      const rejected = reader!.read().then(() => false, () => true);
      abort();
      assert(await rejected);
    } finally { await reader!.cancel().catch(() => undefined); }
    await query('body-closed');
  });
  currentCase = 'limit-stream';
  await owned(async (signal, abort) => {
    const response = await walletFetch(url('oversize'), { method: 'GET', signal });
    let limited = false;
    try { await boundedResponseText(response, signal, 4096); }
    catch (error) { limited = error instanceof ResponseSizeLimitError; }
    finally { abort(); }
    assert(limited);
    await query('oversize-closed');
  });
  currentCase = 'healthy-after-cancel';
  await query('healthy');
  assert(options.networkCalls() === 0);
  return Object.freeze({ ...options.build, kind: 'native-http', status: 'passed', nativeHttpQualified: true,
    token: launch.token, phase: options.phase, scenario: options.scenario,
    platform: options.platform, sessionId: options.sessionId, networkCalls: 0, cases: [...HTTP_CASES] });
  } catch { throw new HttpQualificationError(currentCase); }
}
