import { getAddress } from 'ethers/address';
import {
  parseErc20Units,
  type Erc20Metadata,
} from '../../../../source/shared/erc20.ts';
import { parseErc20Metadata } from './erc20Metadata.ts';
import { createErc20Reader, type Erc20Reader } from './erc20ReadRpc.ts';
import type { NativeTokenInventory } from './tokenRegistry.ts';
import { NativeTokenRegistryError } from './tokenRegistry.ts';
import type {
  NativePortfolioAccount,
  PublicCustodySource,
} from './nativePortfolio.ts';
import { getNativeNetwork } from '../custody/networkContext.ts';

export interface NativeTokenRuntime {
  load(assertCurrent: () => void): Promise<NativeTokenInventory>;
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
}
export type NativeTokenItem = Readonly<{
  metadata: Erc20Metadata;
  status: 'unknown' | 'loading' | 'available' | 'error';
  units: string | null;
  updatedAt: number | null;
}>;
export type NativeTokenSnapshot = Readonly<{
  account: NativePortfolioAccount | null;
  status: 'unavailable' | 'loading' | 'ready' | 'error';
  items: readonly NativeTokenItem[];
  preview: Readonly<{ metadata: Erc20Metadata; units: string }> | null;
  previewStatus: 'idle' | 'loading' | 'ready' | 'error';
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
    | 'refresh'
    | 'remove'
  >
>;
type Request = {
  epoch: number;
  connection: object;
  account: NativePortfolioAccount;
  controller: AbortController;
};
const initial = (
  account: NativePortfolioAccount | null = null
): NativeTokenSnapshot =>
  Object.freeze({
    account,
    status: account ? 'loading' : 'unavailable',
    items: Object.freeze([]),
    preview: null,
    previewStatus: 'idle',
    busy: false,
    error: null,
  });
const same = (
  a: NativePortfolioAccount | null,
  b: NativePortfolioAccount | null
) =>
  a === b ||
  Boolean(
    a &&
      b &&
      a.address === b.address &&
      a.network === b.network &&
      a.revision === b.revision
  );
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
    refresh: (contract?: string) => this.refresh(contract),
    remove: (contract: string) => this.remove(contract),
  });
  private state = initial();
  private listeners = new Set<() => void>();
  private connection: object | null = null;
  private unsubscribe: (() => void) | null = null;
  private epoch = 0;
  private request: Request | null = null;
  private inventoryRevision: number | null = null;
  private loadWork: Promise<NativeTokenInventory> | null = null;
  private unpublished = false;
  private readonly source: PublicCustodySource;
  private readonly runtime: () => NativeTokenRuntime | undefined;
  private readonly reader: Erc20Reader;
  private readonly now: () => number;
  private readonly revoke: () => void;
  constructor(
    source: PublicCustodySource,
    runtime: () => NativeTokenRuntime | undefined,
    reader: Erc20Reader = createErc20Reader(),
    now: () => number = Date.now,
    revoke: () => void = () => undefined
  ) {
    this.source = source;
    this.runtime = runtime;
    this.reader = reader;
    this.now = now;
    this.revoke = revoke;
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
  private readAccount(): NativePortfolioAccount | null {
    try {
      const state = this.source.getSnapshot();
      if (
        state.phase !== 'ready' ||
        !state.account ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 0
      )
        return null;
      const network = getNativeNetwork(state.account.network);
      return Object.freeze({
        address: getAddress(state.account.address),
        network: network.id,
        revision: state.revision,
      });
    } catch {
      return null;
    }
  }
  private cancel(): void {
    this.epoch++;
    this.request?.controller.abort();
    this.request = null;
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
    const account = this.connection ? this.readAccount() : null;
    if (!same(account, this.state.account)) {
      this.cancel();
      this.inventoryRevision = null;
      this.state = initial(account);
      this.unpublished = true;
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
    try {
      this.unsubscribe?.();
    } finally {
      this.unsubscribe = null;
      this.state = initial();
      this.emit();
    }
  }
  private begin(expected = this.state.account): Request | null {
    this.synchronize(true);
    const connection = this.connection;
    const account = this.state.account;
    if (!connection || !account || !same(expected, account)) return null;
    this.cancel();
    const request = {
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
      same(this.state.account, request.account)
    );
  }
  private guard(request: Request): void {
    if (!this.current(request) || request.controller.signal.aborted)
      throw new Error('CANCELLED');
  }
  private install(inventory: NativeTokenInventory): void {
    if (
      !inventory ||
      !Number.isSafeInteger(inventory.revision) ||
      inventory.revision < 0 ||
      !Array.isArray(inventory.items) ||
      inventory.items.length > 256
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
    this.inventoryRevision = inventory.revision;
    this.publish({ items: Object.freeze(items), status: 'ready' });
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
    const request = this.begin();
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
        this.publish({
          status: 'error',
          items: Object.freeze([]),
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
    const request = this.begin();
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
    this.cancel();
    this.publish({ preview: null, previewStatus: 'idle', error: null });
  };
  confirmPreview = async (): Promise<void> => {
    const account = this.state.account;
    if (this.synchronize(true) || !same(account, this.state.account)) return;
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
    if (this.synchronize(true) || !same(account, this.state.account)) return;
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
  private async mutate(
    account: NativePortfolioAccount | null,
    action: (
      runtime: NativeTokenRuntime,
      revision: number,
      guard: () => void
    ) => Promise<NativeTokenInventory>
  ): Promise<void> {
    const revision = this.inventoryRevision;
    const request = this.begin(account);
    if (!request || revision === null) return;
    this.publish({ busy: true, error: null });
    try {
      this.guard(request);
      const runtime = this.runtime();
      if (!runtime) throw new Error('UNAVAILABLE');
      const inventory = await action(runtime, revision, () =>
        this.guard(request)
      );
      this.guard(request);
      this.install(inventory);
      this.guard(request);
      this.request = null;
      this.publish({ busy: false, preview: null, previewStatus: 'idle' });
      void this.refresh();
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
    }
  }
}
