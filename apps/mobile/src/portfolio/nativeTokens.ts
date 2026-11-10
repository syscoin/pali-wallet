import { getAddress } from 'ethers/address';
import { findRegisteredEvmNetwork } from '../../../../source/shared/evmNetworks.ts';
import {
  parseErc20Units,
  type Erc20Metadata,
} from '../../../../source/shared/erc20.ts';
import { normalizeNftTokenId } from '../../../../source/utils/nftTokenId.ts';
import { normalizeErc20Address, parseErc20Metadata } from './erc20Metadata.ts';
import { createErc20Reader, Erc20ReadError, type Erc20Reader } from './erc20ReadRpc.ts';
import type { NativeTokenInventory, NativeTokenPortfolioScope, SavedCollectible } from './tokenRegistry.ts';
import { NativeTokenRegistryError, snapshotSavedCollectible } from './tokenRegistry.ts';
import {
  sameNativePortfolioAccount,
  type NativePortfolioAccount,
  type PublicCustodySource,
} from './nativePortfolio.ts';
import { getNativeNetwork, getNativeSendContext, type NativeSendContext } from '../custody/networkContext.ts';
import type {
  OwnedCollectibleSuggestion,
  OwnedTokenReader,
  OwnedTokenSuggestions,
} from './ownedTokenReader.ts';
import type { createNftOwnershipReader } from './nftOwnershipReadRpc.ts';

export interface NativeTokenRuntime {
  load(assertCurrent: () => void): Promise<NativeTokenInventory>;
  loadScoped?(scope: NativeTokenPortfolioScope, assertCurrent: () => void): Promise<NativeTokenInventory>;
  add(
    expectedRevision: number,
    metadata: Erc20Metadata,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory>;
  remove(
    expectedRevision: number,
    contractAddress: string,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory>;
  addCollectible?(
    expectedRevision: number,
    collectible: SavedCollectible,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory>;
  removeCollectible?(
    expectedRevision: number,
    collectible: SavedCollectible,
    assertCurrent: () => void
  ): Promise<NativeTokenInventory>;
}
export type NativeTokenItem = Readonly<{
  metadata: Erc20Metadata;
  status: 'unknown' | 'loading' | 'available' | 'error';
  units: string | null;
  updatedAt: number | null;
}>;
type TokenDiscovery = OwnedTokenSuggestions &
  Readonly<{ status: 'idle' | 'loading' | 'ready' | 'error' }>;
export type CollectibleQuery = Pick<
  OwnedCollectibleSuggestion,
  'contractAddress' | 'tokenStandard'
> & Readonly<{ tokenId: string }>;
declare const collectibleSaveBrand: unique symbol;
export type CollectibleSaveTicket = Readonly<{ [collectibleSaveBrand]: true }>;
export type CollectibleCheckResult = Readonly<{
  tokenId: string;
  units: string;
  alreadySaved?: true;
  saveTicket?: CollectibleSaveTicket;
}>;
type CollectibleReview = Readonly<{
  ticket: CollectibleSaveTicket;
  account: NativePortfolioAccount;
  collectible: SavedCollectible;
  runtime: NativeTokenRuntime;
  signal: AbortSignal;
  retire: () => void;
  assertCurrent: () => void;
}>;
const idleDiscovery: TokenDiscovery = Object.freeze({
  status: 'idle',
  tokens: Object.freeze([]),
  limited: false,
});
export type NativeTokenSnapshot = Readonly<{
  account: NativePortfolioAccount | null;
  network?: Pick<NativeSendContext, 'name' | 'chainId' | 'symbol' | 'testnet'> | null;
  status: 'unavailable' | 'loading' | 'ready' | 'error';
  items: readonly NativeTokenItem[];
  collectibles?: readonly SavedCollectible[];
  preview: Readonly<{ metadata: Erc20Metadata; units: string }> | null;
  previewStatus: 'idle' | 'loading' | 'ready' | 'error';
  discovery: TokenDiscovery | null;
  canCheckCollectible?: true;
  busy: boolean;
  error: string | null;
}>;
export type NativeTokenView = Readonly<
  Pick<
    NativeTokens,
    | 'getSnapshot'
    | 'subscribe'
    | 'connect'
    | 'preview'
    | 'confirmPreview'
    | 'cancelPreview'
    | 'discover'
    | 'closeDiscovery'
    | 'checkCollectible'
    | 'checkManualCollectible'
    | 'checkSavedCollectible'
    | 'saveCollectible'
    | 'removeCollectible'
    | 'refresh'
    | 'remove'
  >
>;
type Request = {
  kind: 'refresh' | 'preview' | 'mutation';
  epoch: number;
  connection: object;
  account: NativePortfolioAccount;
  controller: AbortController;
};
const initial = (
  account: NativePortfolioAccount | null = null
): NativeTokenSnapshot =>
  Object.freeze({
    account, network: null,
    status: account ? 'loading' : 'unavailable',
    items: Object.freeze([]),
    preview: null,
    previewStatus: 'idle',
    discovery: null,
    busy: false,
    error: null,
  });
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(new Error('CANCELLED'));
  }
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('CANCELLED'));
    signal.addEventListener('abort', cancel, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', cancel));
  });
}
/** Public token observations and local configuration only; no signing capability. */
export class NativeTokens {
  readonly view: NativeTokenView = Object.freeze({
    getSnapshot: () => this.getSnapshot(),
    subscribe: (listener: () => void) => this.subscribe(listener),
    connect: () => this.connect(),
    preview: (contract: string) => this.preview(contract),
    confirmPreview: () => this.confirmPreview(),
    cancelPreview: () => this.cancelPreview(),
    discover: (kind?: 'collectibles') => this.discover(kind),
    closeDiscovery: () => this.closeDiscovery(),
    checkCollectible: (item: OwnedCollectibleSuggestion, id: string, signal: AbortSignal) =>
      this.checkCollectible(item, id, signal),
    checkManualCollectible: (account: NativePortfolioAccount, query: CollectibleQuery, signal: AbortSignal) =>
      this.checkManualCollectible(account, query, signal),
    checkSavedCollectible: (account: NativePortfolioAccount, item: SavedCollectible, tokenId: string, signal: AbortSignal) =>
      this.checkSavedCollectible(account, item, tokenId, signal),
    saveCollectible: (ticket: CollectibleSaveTicket) => this.saveCollectible(ticket),
    removeCollectible: (account: NativePortfolioAccount, item: SavedCollectible) => this.removeCollectible(account, item),
    refresh: (contract?: string) => this.refresh(contract),
    remove: (contract: string) => this.remove(contract),
  });
  private state = initial();
  private listeners = new Set<() => void>();
  private connection: object | null = null;
  private unsubscribe: (() => void) | null = null;
  private epoch = 0;
  private request: Request | null = null;
  private discoveryRequest: AbortController | null = null;
  private collectibleRequest: AbortController | null = null;
  private collectibleReview: CollectibleReview | null = null;
  private discoveryApi = '';
  private registrationHash: string | null = null;
  private inventoryRevision: number | null = null;
  private loadWork: Promise<NativeTokenInventory> | null = null;
  private unpublished = false;
  private readonly source: PublicCustodySource;
  private readonly runtime: () => NativeTokenRuntime | undefined;
  private readonly reader: Erc20Reader;
  private readonly now: () => number;
  private readonly revoke: () => void;
  private readonly readHoldings?: OwnedTokenReader;
  private readonly readNft?: ReturnType<typeof createNftOwnershipReader>;
  constructor(
    source: PublicCustodySource,
    runtime: () => NativeTokenRuntime | undefined,
    reader: Erc20Reader = createErc20Reader(),
    now: () => number = Date.now,
    revoke: () => void = () => undefined,
    readHoldings?: OwnedTokenReader,
    readNft?: ReturnType<typeof createNftOwnershipReader>
  ) {
    this.source = source;
    this.runtime = runtime;
    this.reader = reader;
    this.now = now;
    this.revoke = revoke;
    this.readHoldings = readHoldings;
    this.readNft = readNft;
  }
  private runtimeFailed(error: unknown): void {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'CLEANUP_FAILED'
    )
      this.revoke();
  }
  private readScope() {
    try {
      const state = this.source.getSnapshot();
      if (
        state.phase !== 'ready' ||
        !state.account ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 0
      )
        return null;
      const catalogue = this.source.getCatalogue?.();
      const registration = getNativeNetwork(
        state.account.network,
        catalogue?.networks
      );
      return {
        account: Object.freeze({
          address: getAddress(state.account.address),
          network: registration.id,
          revision: state.revision,
        }),
        network: getNativeSendContext(registration),
        canCheckCollectible: !!this.readNft && (!this.source.getCatalogue || !!catalogue),
        apiUrl: this.readHoldings && (!this.source.getCatalogue || catalogue)
          ? findRegisteredEvmNetwork(registration)?.network.apiUrl ?? ''
          : '',
      };
    } catch {
      return null;
    }
  }
  private cancel(): void {
    this.epoch++;
    this.request?.controller.abort();
    this.request = null;
  }
  private stopDiscovery(): void {
    this.clearCollectibleReview();
    const request = this.discoveryRequest;
    request?.abort();
    if (this.discoveryRequest === request) this.discoveryRequest = null;
    const collectible = this.collectibleRequest;
    this.collectibleRequest = null;
    collectible?.abort();
  }
  private clearCollectibleReview(): void {
    const review = this.collectibleReview;
    this.collectibleReview = null;
    if (review) review.signal.removeEventListener('abort', review.retire);
  }
  private emit(): void {
    this.unpublished = false;
    const current = this.state;
    for (const listener of [...this.listeners]) {
      if (this.state !== current) break;
      if (this.listeners.has(listener))
        try {
          listener();
        } catch {
          /* Observers cannot prevent revocation. */
        }
    }
  }
  private publish(update: Partial<NativeTokenSnapshot>, notify = true): void {
    this.state = Object.freeze({ ...this.state, ...update });
    this.unpublished = true;
    if (notify) this.emit();
  }
  private synchronize(notify: boolean): boolean {
    const scope = this.connection ? this.readScope() : null;
    const account = scope?.account ?? null;
    const registrationHash = scope?.network.registrationHash ?? null;
    const apiUrl = scope?.apiUrl ?? '';
    const canCheckCollectible = scope?.canCheckCollectible ? true : undefined;
    if (
      !sameNativePortfolioAccount(account, this.state.account) ||
      registrationHash !== this.registrationHash ||
      apiUrl !== this.discoveryApi ||
      canCheckCollectible !== this.state.canCheckCollectible
    ) {
      this.cancel();
      this.inventoryRevision = null;
      this.registrationHash = registrationHash;
      this.discoveryApi = apiUrl;
      this.state = Object.freeze({
        ...initial(account),
        network: scope?.network ?? null,
        discovery: this.discoveryApi ? idleDiscovery : null,
        ...(canCheckCollectible ? { canCheckCollectible } : {}),
      });
      this.unpublished = true;
      this.stopDiscovery();
      if (notify) this.emit();
      return true;
    }
    if (notify && this.unpublished) this.emit();
    return false;
  }
  getSnapshot = (): NativeTokenSnapshot => {
    this.synchronize(false);
    return this.state;
  };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  connect = (): (() => void) => {
    const old = this.unsubscribe;
    const connection = {};
    this.connection = connection;
    this.unsubscribe = null;
    this.cancel();
    this.stopDiscovery();
    this.state = initial();
    this.inventoryRevision = null;
    try {
      old?.();
    } catch {
      /* Replaced connection is retired. */
    }
    if (this.connection !== connection) return () => undefined;
    const changed = () => {
      if (this.connection !== connection) return;
      const switched = this.synchronize(true);
      if (
        this.state.account &&
        (switched || this.state.status === 'loading') &&
        !this.request
      )
        void this.refresh();
    };
    try {
      const unsubscribe = this.source.subscribe(changed);
      if (this.connection !== connection) {
        unsubscribe();
        return () => undefined;
      }
      this.unsubscribe = unsubscribe;
    } catch {
      if (this.connection === connection) {
        this.connection = null;
        this.cancel();
        this.stopDiscovery();
        this.state = initial();
        this.emit();
      }
      return () => undefined;
    }
    changed();
    return () => {
      if (this.connection !== connection) return;
      this.connection = null;
      this.cancel();
      this.stopDiscovery();
      const unsub = this.unsubscribe;
      this.unsubscribe = null;
      this.state = initial();
      this.inventoryRevision = null;
      try {
        unsub?.();
      } catch {
        /* Cleanup still retires the connection. */
      }
      this.emit();
    };
  };
  dispose(): void {
    this.connection = null;
    this.cancel();
    this.stopDiscovery();
    try {
      this.unsubscribe?.();
    } finally {
      this.unsubscribe = null;
      this.state = initial();
      this.emit();
    }
  }
  private begin(
    kind: Request['kind'],
    expected = this.state.account
  ): Request | null {
    this.synchronize(true);
    const connection = this.connection;
    const account = this.state.account;
    if (!connection || !account || !sameNativePortfolioAccount(expected, account)) return null;
    this.cancel();
    const request = {
      kind,
      epoch: this.epoch,
      connection,
      account,
      controller: new AbortController(),
    };
    this.request = request;
    return request;
  }
  private current(request: Request): boolean {
    this.synchronize(true);
    return (
      this.request === request &&
      this.connection === request.connection &&
      this.epoch === request.epoch &&
      sameNativePortfolioAccount(this.state.account, request.account)
    );
  }
  private guard(request: Request): void {
    if (!this.current(request) || request.controller.signal.aborted)
      throw new Error('CANCELLED');
  }
  private install(inventory: NativeTokenInventory, preserveItems = false): void {
    if (
      !inventory ||
      !Number.isSafeInteger(inventory.revision) ||
      inventory.revision < 0 ||
      !Array.isArray(inventory.items) ||
      inventory.items.length > 256 ||
      (inventory.collectibles !== undefined &&
        (!Array.isArray(inventory.collectibles) ||
          inventory.items.length + inventory.collectibles.length > 256))
    )
      throw new Error('INVALID');
    const items = inventory.items.map((metadata) =>
      Object.freeze({
        metadata: parseErc20Metadata(metadata),
        status: 'unknown' as const,
        units: null,
        updatedAt: null,
      })
    );
    if (
      new Set(items.map((item) => item.metadata.contractAddress)).size !==
      items.length
    )
      throw new Error('INVALID');
    const observed = preserveItems ? this.state.items : undefined;
    if (observed && (
      observed.length !== items.length ||
      items.some(({ metadata }, index) => {
        const previous = observed[index]?.metadata;
        return !previous || previous.contractAddress !== metadata.contractAddress ||
          previous.name !== metadata.name || previous.symbol !== metadata.symbol ||
          previous.decimals !== metadata.decimals;
      })
    )) throw new Error('INVALID');
    const collectibles = inventory.collectibles?.length
      ? Object.freeze(inventory.collectibles.map(snapshotSavedCollectible))
      : undefined;
    if (inventory.revision !== this.inventoryRevision)
      this.clearCollectibleReview();
    this.inventoryRevision = inventory.revision;
    this.publish({ items: observed ?? Object.freeze(items), collectibles, status: 'ready' });
  }
  private async loadInventory(
    request: Request,
    runtime: NativeTokenRuntime
  ): Promise<NativeTokenInventory> {
    while (this.loadWork) {
      await this.loadWork.catch(() => undefined);
      this.guard(request);
    }
    this.guard(request);
    const work = Promise.resolve().then(() => {
      this.guard(request);
      return runtime.load(() => this.guard(request));
    });
    this.loadWork = work;
    try {
      return await work;
    } finally {
      if (this.loadWork === work) this.loadWork = null;
    }
  }
  discover = async (kind?: 'collectibles'): Promise<void> => {
    this.synchronize(true);
    const { account, network, discovery } = this.state;
    const apiUrl = this.discoveryApi;
    if (
      !this.readHoldings || !account || !network || !discovery || !apiUrl ||
      this.discoveryRequest || this.state.busy || this.state.status !== 'ready'
    ) return;

    const request = new AbortController();
    const current = () => {
      this.synchronize(true);
      return this.discoveryRequest === request;
    };
    const guard = () => {
      if (!current() || request.signal.aborted) throw new Error('CANCELLED');
    };
    const saved = new Set(
      this.state.items.map(({ metadata }) => metadata.contractAddress)
    );
    this.discoveryRequest = request;
    const timer = setTimeout(() => request.abort(), 15_000);
    try {
      this.publish({
        discovery: Object.freeze({ ...idleDiscovery, status: 'loading' }),
      });
      guard();
      const result = await bounded(
        this.readHoldings(
          { address: account.address, chainId: Number(network.chainId), apiUrl,
            ...(kind === 'collectibles' ? { collectiblesOnly: true } : {}) },
          saved,
          request.signal,
          guard
        ),
        request.signal
      );
      guard();
      this.publish({ discovery: Object.freeze({ ...result, status: 'ready' }) });
    } catch {
      if (current())
        this.publish({
          discovery: Object.freeze({ ...idleDiscovery, status: 'error' }),
        });
    } finally {
      clearTimeout(timer);
      request.abort();
      if (this.discoveryRequest === request) this.discoveryRequest = null;
    }
  };
  closeDiscovery = (): void => {
    this.stopDiscovery();
    if (this.state.discovery && this.state.discovery !== idleDiscovery)
      this.publish({ discovery: idleDiscovery });
  };
  checkCollectible = (item: OwnedCollectibleSuggestion, tokenId: string, signal: AbortSignal) =>
    this.readCollectible({ item, tokenId }, signal);
  checkManualCollectible = (account: NativePortfolioAccount, query: CollectibleQuery, signal: AbortSignal) =>
    this.readCollectible({ account, query }, signal);
  checkSavedCollectible = (account: NativePortfolioAccount, saved: SavedCollectible, tokenId: string, signal: AbortSignal) =>
    this.readCollectible({ account, saved, tokenId }, signal);
  private async readCollectible(
    selection: { item: OwnedCollectibleSuggestion; tokenId: string } |
      { account: NativePortfolioAccount; query: CollectibleQuery } |
      { account: NativePortfolioAccount; saved: SavedCollectible; tokenId: string },
    signal: AbortSignal
  ): Promise<CollectibleCheckResult> {
    this.synchronize(false);
    const { account, discovery, canCheckCollectible } = this.state;
    const connection = this.connection, registration = this.registrationHash;
    const revision = this.inventoryRevision;
    const read = this.readNft;
    if (!read || !canCheckCollectible || !account || !connection || !registration ||
      signal.aborted || this.collectibleRequest) throw new Error('CANCELLED');
    const suggested = 'item' in selection ? selection.item : undefined;
    const saved = 'saved' in selection ? selection.saved : undefined;
    const assertSelection = () => {
      this.synchronize(false);
      if (
        signal.aborted ||
        this.connection !== connection ||
        this.state.account !== account ||
        this.registrationHash !== registration ||
        (suggested && (
          this.state.discovery !== discovery || !discovery?.collectibles?.includes(suggested)
        )) ||
        (saved && (
          this.state.status !== 'ready' ||
          this.inventoryRevision !== revision ||
          !this.state.collectibles?.includes(saved)
        ))
      ) throw new Error('CANCELLED');
    };
    if ('account' in selection && selection.account !== account) throw new Error('CANCELLED');
    assertSelection();
    this.clearCollectibleReview();
    let query: CollectibleQuery;
    if ('query' in selection) query = selection.query;
    else {
      const item = 'item' in selection ? selection.item : selection.saved;
      query = { contractAddress: item.contractAddress, tokenStandard: item.tokenStandard, tokenId: selection.tokenId };
    }
    const tokenStandard = query.tokenStandard;
    let tokenId: string, contractAddress: string;
    try {
      if (tokenStandard !== 'ERC-721' && tokenStandard !== 'ERC-1155')
        throw new Error('INVALID');
      tokenId = normalizeNftTokenId(query.tokenId);
      contractAddress = normalizeErc20Address(query.contractAddress);
    } catch {
      throw new Erc20ReadError('INVALID_INPUT');
    }
    if (
      (suggested?.tokenId !== undefined && tokenId !== suggested.tokenId) ||
      (saved?.tokenStandard === 'ERC-1155' && tokenId !== saved.tokenId)
    ) throw new Error('CANCELLED');
    const request = new AbortController();
    this.collectibleRequest = request;
    const stop = () => {
      if (this.collectibleRequest === request) this.collectibleRequest = null;
      request.abort();
    };
    signal.addEventListener('abort', stop, { once: true });
    const current = () => {
      assertSelection();
      if (request.signal.aborted || this.collectibleRequest !== request)
        throw new Error('CANCELLED');
    };
    try {
      current();
      const result = await bounded(read({ networkId: account.network, owner: account.address,
        contractAddress, tokenStandard, tokenId }, request.signal, current), request.signal);
      current();
      const units = parseErc20Units(result.units);
      if (
        result.tokenId !== tokenId ||
        (tokenStandard === 'ERC-721' && units !== '0' && units !== '1')
      )
        throw new Error('INVALID');
      const observation = Object.freeze({ tokenId, units });
      if (saved || revision === null || this.inventoryRevision !== revision ||
        this.state.status !== 'ready' || this.state.busy) return observation;
      if (this.state.items.some(({ metadata }) => metadata.contractAddress === contractAddress) ||
        this.state.collectibles?.some((item) => item.contractAddress === contractAddress &&
          (tokenStandard === 'ERC-721' || item.tokenStandard === 'ERC-721' || item.tokenId === tokenId)))
        return Object.freeze({ ...observation, alreadySaved: true });
      const runtime = this.runtime();
      current();
      if (!runtime?.addCollectible || this.inventoryRevision !== revision ||
        this.state.status !== 'ready' || this.state.busy)
        return observation;
      const collectible = snapshotSavedCollectible(tokenStandard === 'ERC-1155'
        ? { contractAddress, tokenStandard, tokenId }
        : { contractAddress, tokenStandard });
      const ticket = Object.freeze({}) as CollectibleSaveTicket;
      const retire = () => {
        if (this.collectibleReview?.ticket === ticket) this.clearCollectibleReview();
      };
      const assertCurrent = () => {
        assertSelection();
        if (this.inventoryRevision !== revision || this.state.status !== 'ready')
          throw new Error('CANCELLED');
      };
      this.collectibleReview = {
        ticket, account, collectible, runtime, signal, retire, assertCurrent,
      };
      signal.addEventListener('abort', retire, { once: true });
      return Object.freeze({ ...observation, saveTicket: ticket });
    } finally {
      signal.removeEventListener('abort', stop);
      if (this.collectibleRequest === request) this.collectibleRequest = null;
      request.abort();
    }
  }
  refresh = async (contract?: string): Promise<void> => {
    if (this.state.busy) return;
    let target: string | undefined;
    try {
      if (contract !== undefined) target = getAddress(contract);
    } catch {
      return;
    }
    if (
      target &&
      !this.state.items.some((item) => item.metadata.contractAddress === target)
    )
      return;
    const request = this.begin('refresh');
    if (!request) return;
    this.publish({
      status: target ? 'ready' : 'loading',
      preview: null,
      previewStatus: 'idle',
      error: null,
      items: Object.freeze(
        this.state.items.map((item) =>
          item.status === 'loading'
            ? Object.freeze({ ...item, status: 'unknown' as const })
            : item
        )
      ),
    });
    try {
      this.guard(request);
      const runtime = this.runtime();
      if (!runtime) throw new Error('UNAVAILABLE');
      if (!target) {
        const inventory = await this.loadInventory(request, runtime);
        this.guard(request);
        this.install(inventory);
        this.guard(request);
      }
      const pending = this.state.items;
      const indices = pending.flatMap((item, index) =>
        !target || item.metadata.contractAddress === target ? [index] : []
      );
      let next = 0;
      const timer = setTimeout(() => request.controller.abort(), 15_000);
      try {
        const worker = async () => {
          while (
            next < indices.length &&
            this.current(request) &&
            !request.controller.signal.aborted
          ) {
            const index = indices[next++]!;
            const item = pending[index]!;
            const loading = [...this.state.items];
            loading[index] = Object.freeze({ ...item, status: 'loading' });
            this.publish({ items: Object.freeze(loading) });
            let value: NativeTokenItem;
            try {
              this.guard(request);
              const result = await bounded(
                this.reader.readBalance(
                  request.account.network,
                  request.account.address,
                  item.metadata,
                  request.controller.signal
                ),
                request.controller.signal
              );
              this.guard(request);
              const units = parseErc20Units(result.units);
              const updatedAt = this.now();
              if (!Number.isSafeInteger(updatedAt) || updatedAt < 0)
                throw new Error('INVALID');
              value = Object.freeze({
                metadata: item.metadata,
                status: 'available',
                units,
                updatedAt,
              });
            } catch {
              value = Object.freeze({
                metadata: item.metadata,
                status: 'error',
                units: null,
                updatedAt: null,
              });
            }
            if (!this.current(request)) return;
            const items = [...this.state.items];
            items[index] = value;
            this.publish({ items: Object.freeze(items) });
          }
        };
        await Promise.all([worker(), worker()]);
      } finally {
        clearTimeout(timer);
      }
      if (this.current(request)) {
        this.request = null;
        this.publish({ status: 'ready' });
      }
    } catch (error) {
      this.runtimeFailed(error);
      if (this.current(request)) {
        this.request = null;
        this.inventoryRevision = null;
        this.clearCollectibleReview();
        this.publish({
          status: 'error',
          items: Object.freeze([]),
          collectibles: undefined,
          error: 'Saved tokens are unavailable. Refresh to try again.',
        });
      }
    }
  };
  preview = async (contract: string): Promise<void> => {
    if (
      this.state.busy ||
      this.state.status !== 'ready' ||
      this.inventoryRevision === null
    )
      return;
    const request = this.begin('preview');
    if (!request) return;
    this.publish({
      preview: null,
      previewStatus: 'loading',
      error: null,
      items: Object.freeze(
        this.state.items.map((item) =>
          item.status === 'loading'
            ? Object.freeze({ ...item, status: 'unknown' as const })
            : item
        )
      ),
    });
    const timer = setTimeout(() => request.controller.abort(), 15_000);
    try {
      this.guard(request);
      const address = getAddress(contract);
      if (
        this.state.items.some(
          (item) => item.metadata.contractAddress === address
        )
      )
        throw new NativeTokenRegistryError('DUPLICATE');
      const result = await bounded(
        this.reader.readToken(
          request.account.network,
          request.account.address,
          address,
          request.controller.signal
        ),
        request.controller.signal
      );
      this.guard(request);
      const metadata = parseErc20Metadata(result.metadata);
      const units = parseErc20Units(result.units);
      if (metadata.contractAddress !== address) throw new Error('INVALID');
      this.request = null;
      this.publish({
        preview: Object.freeze({ metadata, units }),
        previewStatus: 'ready',
      });
    } catch (error) {
      if (this.current(request)) {
        this.request = null;
        this.publish({
          preview: null,
          previewStatus: 'error',
          error:
            error instanceof NativeTokenRegistryError &&
            error.code === 'DUPLICATE'
              ? 'This token is already in your list.'
              : 'Could not read this token. Check the contract and network, then try again.',
        });
      }
    } finally {
      clearTimeout(timer);
    }
  };
  cancelPreview = (): void => {
    if (this.state.busy) return;
    // Opening or leaving Import clears its state without retiring balance reads.
    if (this.request?.kind === 'preview') this.cancel();
    this.publish({ preview: null, previewStatus: 'idle', error: null });
  };
  confirmPreview = async (): Promise<void> => {
    const account = this.state.account;
    if (this.synchronize(true) || !sameNativePortfolioAccount(account, this.state.account)) return;
    const preview = this.state.preview;
    if (
      !preview ||
      this.state.previewStatus !== 'ready' ||
      this.state.busy ||
      this.inventoryRevision === null
    )
      return;
    await this.mutate(account, (runtime, revision, guard) =>
      runtime.add(revision, preview.metadata, guard)
    );
  };
  remove = async (contract: string): Promise<void> => {
    const account = this.state.account;
    if (this.synchronize(true) || !sameNativePortfolioAccount(account, this.state.account)) return;
    if (
      this.state.busy ||
      this.state.status !== 'ready' ||
      this.inventoryRevision === null
    )
      return;
    let address: string;
    try {
      address = getAddress(contract);
    } catch {
      return;
    }
    if (
      !this.state.items.some(
        (item) => item.metadata.contractAddress === address
      )
    )
      return;
    await this.mutate(account, (runtime, revision, guard) =>
      runtime.remove(revision, address, guard)
    );
  };
  saveCollectible = async (ticket: CollectibleSaveTicket): Promise<boolean> => {
    const review = this.collectibleReview;
    if (!review || review.ticket !== ticket) return false;
    // Consume consent before any subscriber or asynchronous persistence work.
    this.clearCollectibleReview();
    try { review.assertCurrent(); } catch { return false; }
    if (this.state.busy) return false;
    return this.mutate(review.account, (runtime, revision, guard) => {
      if (runtime !== review.runtime || !runtime.addCollectible) throw new Error('CANCELLED');
      return runtime.addCollectible(revision, review.collectible, guard);
    }, { preserveItems: true, assertCurrent: review.assertCurrent });
  };
  removeCollectible = async (account: NativePortfolioAccount, item: SavedCollectible): Promise<boolean> => {
    this.synchronize(false);
    const revision = this.inventoryRevision;
    const assertCurrent = () => {
      this.synchronize(false);
      if (this.state.account !== account || this.state.status !== 'ready' ||
        revision === null || this.inventoryRevision !== revision ||
        !this.state.collectibles?.includes(item)) throw new Error('CANCELLED');
    };
    try { assertCurrent(); } catch { return false; }
    if (this.state.busy) return false;
    return this.mutate(account, (runtime, expected, guard) => {
      if (!runtime.removeCollectible) throw new Error('UNAVAILABLE');
      return runtime.removeCollectible(expected, item, guard);
    }, { preserveItems: true, assertCurrent });
  };
  private async mutate(
    account: NativePortfolioAccount | null,
    action: (
      runtime: NativeTokenRuntime,
      revision: number,
      guard: () => void
    ) => Promise<NativeTokenInventory>,
    { preserveItems = false, assertCurrent }: { preserveItems?: boolean; assertCurrent?: () => void } = {}
  ): Promise<boolean> {
    const revision = this.inventoryRevision;
    const request = this.begin('mutation', account);
    if (!request || revision === null) return false;
    this.clearCollectibleReview();
    const guard = () => {
      this.guard(request);
      assertCurrent?.();
    };
    // begin() may retire a targeted ERC-20 balance read. Keep its last
    // observation when the collectible mutation does not run a refresh.
    const items = preserveItems && this.state.items.some((item) => item.status === 'loading')
      ? Object.freeze(this.state.items.map((item): NativeTokenItem =>
        item.status !== 'loading' ? item : Object.freeze({
          ...item,
          status: item.updatedAt === null ? 'unknown' : 'available',
        })
      ))
      : this.state.items;
    this.publish({ busy: true, error: null, items });
    try {
      guard();
      const runtime = this.runtime();
      if (!runtime) throw new Error('UNAVAILABLE');
      const inventory = await action(runtime, revision, guard);
      guard();
      this.install(inventory, preserveItems);
      this.guard(request);
      this.request = null;
      this.publish({ busy: false, preview: null, previewStatus: 'idle' });
      if (!preserveItems) void this.refresh();
      return true;
    } catch (error) {
      this.runtimeFailed(error);
      if (this.current(request)) {
        this.request = null;
        this.inventoryRevision = null;
        this.publish({
          busy: false,
          status: 'error',
          preview: null,
          previewStatus: 'idle',
          error:
            error instanceof NativeTokenRegistryError &&
            error.code === 'CAPACITY'
              ? 'Your token list is full. Remove an entry before adding another token.'
              : 'The token change could not be confirmed. Refresh to check your saved list.',
        });
      }
      return false;
    }
  }
}
