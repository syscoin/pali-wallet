import { boundedResponseText, createBalanceReader, parseRpcResult, ResponseSizeLimitError, RPC_ENDPOINTS } from '../src/platformRpc.ts';
import type { HttpBuild, HttpLaunch } from './http-contract.ts';
import { POST_CASES, type PostCase, type PostReport, type PostFailureDetail } from './post-contract.ts';
import { POST_ADDRESS, POST_RETRY_BODY, POST_UNITS } from './post-fixtures.ts';

type FetchPort = (url: string, init: RequestInit) => Promise<Response>;
const assert = (condition: unknown): void => { if (!condition) throw Error('POST_QUALIFICATION_FAILED'); };
export class PostQualificationError extends Error {
  readonly failedCase: PostCase;
  readonly failureDetail: PostFailureDetail;
  constructor(failedCase: PostCase, failureDetail: PostFailureDetail) {
    super('POST_QUALIFICATION_FAILED'); this.failedCase = failedCase; this.failureDetail = Object.freeze({ ...failureDetail });
  }
}

/** Native transport only. No custody runtime, signing or real endpoint dispatch. */
export async function qualifyNativePost(options: Readonly<{
  launch: HttpLaunch; build: HttpBuild; walletFetch: FetchPort;
  phase: PostReport['phase']; scenario: PostReport['scenario']; platform: PostReport['platform'];
  sessionId: string; networkCalls: () => number;
}>): Promise<PostReport> {
  let route = 'post-balance', attempt = 0;
  let rejection: PostFailureDetail['rejection'] = 'none';
  const classify = (error: unknown): PostFailureDetail['rejection'] => error instanceof ResponseSizeLimitError ? 'size-limit'
    : error instanceof Error && error.name === 'AbortError' ? 'abort' : 'other';
  const url = (route: string) => `http://127.0.0.1:${options.launch.port}/${options.launch.token}/${route}?q=exact`;
  const owned = async <T>(fn: (signal: AbortSignal, abort: () => void) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('POST_QUALIFICATION_TIMEOUT')); }, 8000);
    });
    try { return await Promise.race([fn(controller.signal, () => controller.abort()), deadline]); }
    finally { controller.abort(); clearTimeout(timer); }
  };
  const balance = (nextRoute: string, signal: AbortSignal) => {
    route = nextRoute; attempt = 0; rejection = 'none';
    return createBalanceReader({ timeoutMs: 6000, fetch: (original, init) => {
      assert(original === RPC_ENDPOINTS.ethereum && init.method === 'POST' && typeof init.body === 'string');
      // Qualification-only exact-origin redirection. There is no fallback dispatch.
      return options.walletFetch(url(nextRoute), init);
    } }).readBalance('ethereum', POST_ADDRESS, signal);
  };
  const control = (nextRoute: string) => owned(async signal => {
    route = nextRoute; attempt = 0; rejection = 'none';
    const response = await options.walletFetch(url(nextRoute), { method: 'GET', headers: { Accept: 'application/json' }, signal });
    assert(response.ok && response.url === url(nextRoute) && !response.redirected);
    assert(await boundedResponseText(response, signal, 1024) === '{"ok":true}');
  });
  let currentCase: PostCase = 'rpc-post-roundtrip';
  try {
    for (const [route, units] of [['post-balance', POST_UNITS], ['post-zero', '0']] as const) await owned(async signal => {
      const result = await balance(route, signal); assert(result.chainId === 1 && result.units === units);
    });
    currentCase = 'rpc-post-invalid-response';
    for (const route of ['post-id', 'post-error', 'post-malformed', 'post-type']) await owned(async signal => {
      let rejected = false;
      try { await balance(route, signal); } catch (error) { rejection = classify(error); rejected = error instanceof Error && error.name !== 'AbortError'; }
      assert(rejected && !signal.aborted);
    });
    currentCase = 'rpc-post-body-limit';
    for (const route of ['post-declared', 'post-stream']) await owned(async signal => {
      let limited = false;
      try { await balance(route, signal); } catch (error) { rejection = classify(error); limited = error instanceof ResponseSizeLimitError; }
      assert(limited && !signal.aborted);
    });
    currentCase = 'rpc-post-abort';
    await owned(async (signal, abort) => {
      const rejected = balance('post-abort', signal).then(() => false, error => {
        rejection = classify(error); return error instanceof Error && error.name === 'AbortError';
      });
      await control('post-ready'); route = 'post-abort'; assert(!signal.aborted); abort(); assert(await rejected);
    });
    await control('post-closed');
    await owned(async signal => { assert((await balance('post-healthy', signal)).units === POST_UNITS); });
    currentCase = 'post-lost-response-exact-retry';
    await owned(async signal => {
      route = 'post-lost'; attempt = 0; rejection = 'none';
      const attemptRequest = async () => {
        attempt++; rejection = 'none';
        const response = await options.walletFetch(url('post-lost'), { method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: POST_RETRY_BODY });
        assert(response.ok && response.url === url('post-lost') && !response.redirected);
        const mime = response.headers.get('content-type'); assert(mime === 'application/json');
        assert(parseRpcResult(await boundedResponseText(response, signal), 47) === BigInt(POST_UNITS));
      };
      let rejected = false;
      try { await attemptRequest(); } catch (error) { rejection = classify(error); rejected = true; }
      assert(rejected && !signal.aborted);
      // Deliberate second call of the identical frozen synthetic body, not a transaction retry.
      await attemptRequest();
    });
    assert(options.networkCalls() === 0);
    return Object.freeze({ ...options.build, kind: 'native-post', status: 'passed', nativePostQualified: true,
      token: options.launch.token, phase: options.phase, scenario: options.scenario, platform: options.platform,
      sessionId: options.sessionId, networkCalls: 0, cases: [...POST_CASES] });
  } catch (error) {
    if (rejection === 'none' && !(error instanceof Error && error.message === 'POST_QUALIFICATION_FAILED')) rejection = classify(error);
    throw new PostQualificationError(currentCase, { route, attempt, rejection });
  }
}
