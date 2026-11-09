import {
  JsonRpcProvider,
  type ProviderEvent,
} from 'ethers/providers';
import { FetchRequest, toUtf8Bytes } from 'ethers/utils';
import {
  ENS_RECIPIENT_TTL_MS,
  ENS_RESOLUTION_CHAIN_ID,
  isEnsRecipientName,
  resolveEnsRecipientName,
  selectEnsResolutionNetwork,
} from '../../../../source/shared/ensRecipient.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { abortable, boundedResponseText, cancelResponseBody } from '../platformRpc.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import {
  getNativeNetwork,
  snapshotNativeNetwork,
  type NativeSendContext,
} from '../custody/networkContext.ts';
import type { NativePortfolioAccount, PublicCustodySource } from './nativePortfolio.ts';

export type NativeRecipientResolution = Readonly<{
  input: string;
  address: string;
  expiresAt: number;
  signal: AbortSignal;
  assertCurrent(): void;
  dispose(): void;
}>;
export type NativeRecipientResolver = Readonly<{
  resolve(
    input: string,
    owner: Readonly<{ account: NativePortfolioAccount; context: NativeSendContext }>,
    signal: AbortSignal,
    assertRequestCurrent: () => void
  ): Promise<NativeRecipientResolution>;
}>;

const expired = () => new Error('RECIPIENT_EXPIRED');
const unavailable = () => new Error('ENS_UNAVAILABLE');
const LIMIT = 256 * 1024;

function httpUrl(value: string) {
  const url = new URL(value);
  if (value.length > 4096 || url.username || url.password || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw unavailable();
}

/** Ethers owns ENS/CCIP. Only its per-request HTTP transport is adapted here. */
class RecipientProvider extends JsonRpcProvider {
  private readonly install: (request: FetchRequest) => void;
  constructor(request: FetchRequest, install: (request: FetchRequest) => void) {
    super(request, ENS_RESOLUTION_CHAIN_ID, {
      staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1,
    });
    this.install = install;
  }
  override emit(event: ProviderEvent, ...args: unknown[]): Promise<boolean> {
    // In pinned ethers, this synchronous event precedes request.send(). An async
    // debug listener would run too late. FetchRequest clones retain getUrlFunc.
    const value = args[0] as { action?: string; request?: FetchRequest } | undefined;
    if (event === 'debug' && value?.action === 'sendCcipReadFetchRequest') {
      if (!(value.request instanceof FetchRequest)) throw unavailable();
      this.install(value.request);
    }
    return super.emit(event, ...args);
  }
}

/** One lookup owns its configured ENS source, destination registration and custody session. */
export function createNativeRecipientResolver(ports: Readonly<{
  source: PublicCustodySource;
  fetch(url: string, init: RequestInit): Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
}>): NativeRecipientResolver {
  const now = ports.now ?? Date.now;
  const timeoutMs = ports.timeoutMs ?? 12_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw unavailable();
  return Object.freeze({
    async resolve(input, owner, externalSignal, assertRequestCurrent) {
      if (!isEnsRecipientName(input) || input !== input.trim() || input.length > 1024) throw unavailable();
      const source = ports.source, fetcher = ports.fetch;
      const snapshot = source.getSnapshot(), catalogue = source.getCatalogue?.();
      if (!catalogue) throw expired();
      const destination = snapshotNativeNetwork(getNativeNetwork(owner.context.networkId, catalogue.networks));
      const selected = selectEnsResolutionNetwork(catalogue.networks, (network) => network.chainId);
      if (!selected) throw unavailable();
      const mainnet = snapshotNativeNetwork(selected);
      const account = { ...owner.account }, context = { ...owner.context };
      if (destination.registrationHash !== context.registrationHash || destination.rpcUrl !== context.rpcUrl ||
          destination.chainId !== context.chainId || account.network !== context.networkId) throw expired();
      const controller = new AbortController();
      let expiresAt = Number.POSITIVE_INFINITY;
      let disposed = false, calls = 0;
      let unsubscribe: () => void = () => undefined;
      let timer: ReturnType<typeof setTimeout>;
      const abort = () => controller.abort();
      const check = () => {
        assertSynchronousEvmFeeGuard(assertRequestCurrent);
        const current = source.getSnapshot(), actual = source.getCatalogue?.();
        if (disposed || controller.signal.aborted || externalSignal.aborted || now() >= expiresAt ||
            ports.source !== source || ports.fetch !== fetcher || current.phase !== 'ready' ||
            current.revision !== snapshot.revision || current.revision !== account.revision ||
            current.account?.address.toLowerCase() !== account.address.toLowerCase() ||
            current.account?.network !== account.network || actual?.revision !== catalogue.revision ||
            !actual || getNativeNetwork(destination.id, actual.networks).registrationHash !== destination.registrationHash ||
            getNativeNetwork(mainnet.id, actual.networks).registrationHash !== mainnet.registrationHash) throw expired();
      };
      const dispose = () => {
        disposed = true;
        controller.abort();
        clearTimeout(timer);
        unsubscribe();
        externalSignal.removeEventListener('abort', abort);
      };
      const install = (request: FetchRequest) => {
        check();
        httpUrl(request.url);
        request.timeout = timeoutMs;
        request.setThrottleParams({ maxAttempts: 1 });
        request.getUrlFunc = async (wire) => {
          check();
          httpUrl(wire.url);
          if (++calls > 32 || (wire.body?.length ?? 0) > LIMIT || !['GET', 'POST'].includes(wire.method)) throw unavailable();
          const pending = fetcher(wire.url, {
            method: wire.method,
            headers: wire.headers,
            ...(wire.body ? { body: new Uint8Array(wire.body) } : {}),
            signal: controller.signal, credentials: 'omit', redirect: 'error',
            cache: 'no-store', referrerPolicy: 'no-referrer',
          }).then((response) => {
            try { check(); return response; }
            catch (error) { cancelResponseBody(response); throw error; }
          });
          void pending.catch(() => undefined);
          const response = await abortable(pending, controller.signal);
          try {
            check();
            if (response.redirected || response.url !== wire.url ||
                response.status >= 300 && response.status < 400) throw unavailable();
            const text = await boundedResponseText(response, controller.signal, LIMIT);
            check();
            return { statusCode: response.status, statusMessage: response.statusText,
              headers: Object.fromEntries(response.headers.entries()), body: toUtf8Bytes(text) };
          } catch (error) {
            cancelResponseBody(response);
            throw error;
          }
        };
      };
      externalSignal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, timeoutMs);
      let provider: RecipientProvider | undefined;
      try {
        check();
        unsubscribe = source.subscribe(() => { try { check(); } catch { abort(); } });
        const request = new FetchRequest(mainnet.rpcUrl);
        install(request);
        provider = new RecipientProvider(request, install);
        if (BigInt(await abortable(provider.send('eth_chainId', []), controller.signal)) !== BigInt(ENS_RESOLUTION_CHAIN_ID)) throw unavailable();
        check();
        const address = await abortable(resolveEnsRecipientName(input, (name) => provider!.resolveName(name)), controller.signal);
        check();
        if (!address) throw unavailable();
        const canonical = normalizePublicAddress(address, destination.id);
        expiresAt = now() + ENS_RECIPIENT_TTL_MS;
        clearTimeout(timer);
        timer = setTimeout(abort, ENS_RECIPIENT_TTL_MS);
        return Object.freeze({ input, address: canonical, expiresAt, signal: controller.signal, assertCurrent: check, dispose });
      } catch (error) {
        const cancelled = controller.signal.aborted || externalSignal.aborted;
        dispose();
        throw cancelled ? expired() : error;
      } finally {
        provider?.destroy();
      }
    },
  });
}
