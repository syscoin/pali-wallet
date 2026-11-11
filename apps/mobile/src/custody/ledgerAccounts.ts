import {
  nativeLedgerFailureCategory,
  nativeLedgerFailureMessage,
  type NativeLedgerFailureCategory,
} from '../hardware/ledgerFailure.ts';
import type { NativeCustodyAuthority } from './authority.ts';
import type { NativeWalletCatalogueSnapshot } from './walletCatalogue.ts';
export type NativeLedgerDevice = Readonly<{
  id: string;
  name: string;
  model: string;
}>;

export type NativeLedgerSnapshot = Readonly<{
  phase:
    | 'idle'
    | 'scanning'
    | 'connecting'
    | 'connected'
    | 'importing'
    | 'error';
  networkId: string | null;
  networkLabel: string;
  address: string | null;
  devices: readonly NativeLedgerDevice[];
  selectedName: string | null;
  error: string | null;
  failure?: NativeLedgerFailureCategory | null;
}>;

/** Public account-import controls. Device handles cannot sign or export keys. */
interface NativeLedgerViewBase {
  getSnapshot(): NativeLedgerSnapshot;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  select(id: string): Promise<void>;
  close(): Promise<void>;
}
export interface NativeLedgerImportView extends NativeLedgerViewBase {
  readonly purpose: 'import';
  importAccount(label: string): Promise<void>;
}
export interface NativeLedgerConnectionView extends NativeLedgerViewBase {
  readonly purpose: 'connect';
  isConnected(): boolean;
  finishConnection(): Promise<void>;
}
export type NativeLedgerView =
  | NativeLedgerImportView
  | NativeLedgerConnectionView;

/** Private picker capability. Raw device handles remain with the runtime. */
export interface NativeLedgerRuntime {
  subscribeStatus(listener: () => void): () => void;
  isConnected(): boolean;
  getConnectionTargets(): readonly string[];
  scan(
    request: Readonly<
      | { purpose: 'import' }
      | { purpose: 'connect'; accountIds: readonly string[] }
    >,
    signal: AbortSignal,
    assertCurrent: () => void,
    onDevices: (devices: readonly NativeLedgerDevice[]) => void,
    onError: (error: unknown) => void
  ): Promise<{
    select(id: string): Promise<Readonly<{ name: string; address: string }>>;
    handoff(): void;
    close(): Promise<void>;
  }>;
}

type LedgerAuthority = Pick<
  NativeCustodyAuthority,
  | 'getSnapshot'
  | 'getCatalogue'
  | 'subscribe'
  | 'manageAccounts'
  | 'cancelAccountOperation'
>;
type Scan = Awaited<ReturnType<NativeLedgerRuntime['scan']>>;
type Session = {
  controller: AbortController;
  revision: number;
  catalogue: NativeWalletCatalogueSnapshot;
  scan?: Scan;
  opening?: Promise<Scan>;
};

const empty = (): NativeLedgerSnapshot =>
  Object.freeze({
    phase: 'idle',
    networkId: null,
    networkLabel: '',
    address: null,
    devices: Object.freeze([]),
    selectedName: null,
    error: null,
    failure: null,
  });

export class NativeLedgerAccounts<Purpose extends 'import' | 'connect'> {
  private snapshot = empty();
  private disposed = false;
  private session: Session | undefined;
  private closing: Promise<void> = Promise.resolve();
  private scanEpoch = 0;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private observedRuntime: NativeLedgerRuntime | undefined;
  private unsubscribeStatus: (() => void) | undefined;

  private readonly authority: LedgerAuthority;
  private readonly runtime: () => NativeLedgerRuntime | undefined;
  readonly purpose: Purpose;
  constructor(
    authority: LedgerAuthority,
    runtime: () => NativeLedgerRuntime | undefined,
    purpose: Purpose
  ) {
    this.purpose = purpose;
    this.authority = authority;
    this.runtime = runtime;
    this.unsubscribe = authority.subscribe((value) => {
      this.bindRuntime();
      const session = this.session;
      if (!session) return;
      const importing = this.snapshot.phase === 'importing';
      if (
        (importing && !['ready', 'authenticating'].includes(value.phase)) ||
        (!importing &&
          (value.phase !== 'ready' || value.revision !== session.revision))
      )
        void this.close().catch(() => undefined);
    });
    this.bindRuntime();
  }

  private bindRuntime() {
    const runtime = this.runtime();
    if (runtime === this.observedRuntime) return;
    this.unsubscribeStatus?.();
    this.observedRuntime = runtime;
    this.unsubscribeStatus = runtime?.subscribeStatus(() => {
      if (!this.disposed && this.observedRuntime === runtime) this.publish({});
    });
    // Read again after subscribing so a transition during binding is visible.
    this.publish({});
  }

  getSnapshot = () => this.snapshot;
  isConnected = () =>
    !this.disposed &&
    this.purpose === 'connect' &&
    this.runtime()?.isConnected() === true;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: Partial<NativeLedgerSnapshot>) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...value });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* UI observation cannot change custody results. */
      }
    }
  }
  private check(session: Session) {
    const current = this.authority.getSnapshot();
    if (
      this.session !== session ||
      session.controller.signal.aborted ||
      current.phase !== 'ready' ||
      current.revision !== session.revision ||
      this.authority.getCatalogue() !== session.catalogue
    )
      throw new Error('CANCELLED');
  }
  private assertActive() {
    if (this.disposed) throw new Error('CANCELLED');
  }
  private async fail(
    session: Session,
    message: string,
    failure: NativeLedgerFailureCategory = 'retry'
  ) {
    if (this.disposed || this.session !== session) return;
    const closing = this.close();
    try {
      await closing;
    } finally {
      if (!this.disposed && !this.session && this.closing === closing)
        this.publish({
          phase: 'error',
          error: nativeLedgerFailureMessage(failure, message),
          failure,
        });
    }
  }
  async start() {
    this.assertActive();
    if (this.session) throw new Error('BUSY');
    const epoch = this.scanEpoch;
    await this.closing;
    this.assertActive();
    if (epoch !== this.scanEpoch) throw new Error('CANCELLED');
    if (this.session) throw new Error('BUSY');
    const snapshot = this.authority.getSnapshot(),
      catalogue = this.authority.getCatalogue(),
      runtime = this.runtime();
    if (snapshot.phase !== 'ready' || !catalogue || !runtime)
      throw new Error('NOT_READY');
    const session: Session = {
      controller: new AbortController(),
      revision: snapshot.revision,
      catalogue,
    };
    this.session = session;
    const networkId = catalogue.active.networkId;
    const network =
      catalogue.networks.find((entry) => entry.id === networkId) ??
      catalogue.utxoNetworks.find((entry) => entry.id === networkId);
    this.publish({
      ...empty(),
      phase: 'scanning',
      networkId,
      networkLabel: network?.name ?? 'Selected network',
      address:
        this.purpose === 'connect'
          ? catalogue.accounts.find(
              (account) => account.id === catalogue.active.accountId
            )?.address ?? null
          : null,
    });
    try {
      session.opening = Promise.resolve().then(() =>
        runtime.scan(
          this.purpose === 'connect'
            ? { purpose: 'connect', accountIds: runtime.getConnectionTargets() }
            : { purpose: 'import' },
          session.controller.signal,
          () => this.check(session),
          (devices) => {
            this.check(session);
            this.publish({ devices });
          },
          (error) => {
            this.check(session);
            void this.fail(
              session,
              'Could not find your Ledger. Keep it nearby and try again.',
              nativeLedgerFailureCategory(error)
            ).catch(() => undefined);
          }
        )
      );
      session.scan = await session.opening;
      this.check(session);
    } catch (error) {
      if (this.session === session)
        await this.fail(
          session,
          'Could not connect to Ledger. Keep it nearby and try again.',
          nativeLedgerFailureCategory(error)
        );
      else await this.closing;
      throw error;
    }
  }
  async select(id: string) {
    this.assertActive();
    const session = this.session;
    if (!session?.scan || this.snapshot.phase !== 'scanning')
      throw new Error('NOT_READY');
    this.check(session);
    this.publish({ phase: 'connecting', error: null });
    try {
      const result = await session.scan.select(id);
      this.check(session);
      this.publish({
        phase: 'connected',
        selectedName: result.name,
        address: result.address,
      });
    } catch (error) {
      await this.fail(
        session,
        (error as { code?: unknown })?.code ===
          'LEDGER_SMART_OWNERS_UNAVAILABLE'
          ? 'Connect the Ledger containing every required owner. Switching between multiple Ledger devices is not supported in this review.'
          : 'Could not read this Ledger account. Open the matching app on your Ledger and try again.',
        nativeLedgerFailureCategory(error)
      );
      throw error;
    }
  }
  async finishConnection() {
    this.assertActive();
    const session = this.session;
    if (
      this.purpose !== 'connect' ||
      !session?.scan ||
      this.snapshot.phase !== 'connected'
    )
      throw new Error('NOT_READY');
    this.check(session);
    session.scan.handoff();
    await this.close();
    if (!this.isConnected()) throw new Error('CANCELLED');
  }
  async importAccount(label: string) {
    this.assertActive();
    if (this.purpose !== 'import') throw new Error('NOT_READY');
    const session = this.session;
    if (!session || this.snapshot.phase !== 'connected')
      throw new Error('NOT_READY');
    this.check(session);
    this.publish({ phase: 'importing', error: null });
    try {
      await this.authority.manageAccounts(
        { kind: 'import-ledger', label },
        session.revision,
        session.catalogue.revision
      );
      if (this.session !== session || session.controller.signal.aborted)
        throw new Error('CANCELLED');
      await this.close();
    } catch (error) {
      await this.fail(
        session,
        'The account could not be added. Unlock your wallet and try again.'
      );
      throw error;
    }
  }
  close(): Promise<void> {
    this.scanEpoch++;
    const session = this.session;
    if (!session) return this.closing;
    const previous = this.closing;
    let resolve!: () => void, reject!: (error: unknown) => void;
    const closing = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    this.closing = closing;
    this.session = undefined;
    if (this.snapshot.phase === 'importing')
      this.authority.cancelAccountOperation();
    session.controller.abort();
    this.publish(empty());
    const retire = (async () => {
      const scan =
        session.scan ?? (await session.opening?.catch(() => undefined));
      await scan?.close();
    })();
    void Promise.all([previous, retire]).then(() => resolve(), reject);
    return this.closing;
  }
  async dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = undefined;
    this.observedRuntime = undefined;
    await this.close();
    this.listeners.clear();
  }
}
