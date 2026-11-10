import { assertBaseUnits, formatBaseUnits } from '../core/amounts.ts';
import type { BalanceReader } from '../core/watchOnlyAuthority.ts';
import type { FiatCurrency } from '../core/fiatPreference.ts';
import type { PublicCustodySource } from './nativePortfolio.ts';
import type { NotificationChoice } from '../notifications/choices.ts';
import type { NativeNotificationScope } from '../notifications/types.ts';
import { formatTokenUnits, type Erc20Metadata } from '../../../../source/shared/erc20.ts';
import type { SavedCollectible } from './tokenRegistry.ts';

export type PortfolioAssets = Readonly<{
  tokens: readonly Readonly<{ metadata: Erc20Metadata; status: 'available' | 'error'; units: string | null }>[];
  collectibles: readonly Readonly<{ collectible: SavedCollectible; status: 'available' | 'error'; units: string | null }>[];
}>;
export type AccountPortfolioRow = Readonly<{
  choice: NotificationChoice;
  status: 'unknown' | 'loading' | 'available' | 'error';
  units: string | null;
  decimals: number;
  updatedAt: number | null;
  price: number | null;
  tokens: readonly Readonly<PortfolioAssets['tokens'][number] & { price: number | null }>[];
  collectibles: PortfolioAssets['collectibles'];
  assetsAvailable: boolean;
}>;
export type AccountPortfolioSnapshot = Readonly<{
  status: 'loading' | 'ready' | 'unavailable';
  accountId: string | null;
  filter: string | null;
  choices: readonly NotificationChoice[];
  rows: readonly AccountPortfolioRow[];
  refreshing: boolean;
  knownValue: number | null;
  partial: boolean;
  currency: FiatCurrency | null;
}>;
type Ports = {
  source: PublicCustodySource;
  choices(): readonly NotificationChoice[];
  reader: BalanceReader;
  filter: { load(): Promise<string>; save(value: string): Promise<void> };
  assets?(scope: NativeNotificationScope, signal: AbortSignal, check: () => void): Promise<PortfolioAssets>;
  nativePrice?(choice: NotificationChoice, currency: FiatCurrency, signal: AbortSignal): Promise<number | null>;
  tokenPrice?(choice: NotificationChoice, token: Erc20Metadata, currency: FiatCurrency, signal: AbortSignal): Promise<number | null>;
  now?: () => number;
};
const empty = (): AccountPortfolioSnapshot => ({ status: 'loading', accountId: null, filter: null, choices: [], rows: [], refreshing: false, knownValue: null, partial: true, currency: null });
const scopeKey = (choice: NotificationChoice) => JSON.stringify(choice.scope);

/** Selected-account reads only. Restoring the filter always precedes the first request. */
export class AccountPortfolioController {
  private state = empty();
  private listeners = new Set<() => void>();
  private connection: object | null = null;
  private unsubscribe: (() => void) | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private filterIntent = 0;
  private filterPending = false;
  private filterFailed = false;
  private owner = '';
  private cache = new Map<string, AccountPortfolioRow>();
  private readonly ports: Ports;
  constructor(ports: Ports) { this.ports = ports; }
  getSnapshot = () => {
    if (!this.connection) return this.state;
    let current: ReturnType<AccountPortfolioController['context']> = null;
    try { current = this.context(); } catch { /* A retired owner has no visible observations. */ }
    if (!current && this.state.status === 'unavailable' && this.state.accountId === null && !this.state.choices.length && !this.state.rows.length)
      return this.state;
    if (!current || current.owner !== this.owner || JSON.stringify(current.choices) !== JSON.stringify(this.state.choices)) {
      this.request?.abort(); this.generation++; this.cache.clear(); this.owner = current?.owner ?? '';
      this.state = Object.freeze({ ...empty(), filter: this.state.filter, currency: this.state.currency,
        status: current && !this.filterFailed ? this.state.filter === null ? 'loading' : 'ready' : 'unavailable',
        accountId: current?.id ?? null, choices: current?.choices ?? [] });
    }
    return this.state;
  };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(update: Partial<AccountPortfolioSnapshot> = {}) {
    const next = { ...this.state, ...update };
    let value = 0, known = false, partial = false;
    const real = next.rows.filter(row => !('testnet' in row.choice.scope.network && row.choice.scope.network.testnet));
    for (const row of real) {
      if (row.status !== 'available' || row.units === null) { partial = true; continue; }
      const amount = Number(formatBaseUnits(row.units, row.decimals));
      if (amount === 0) known = true;
      else if (row.price !== null && Number.isFinite(amount * row.price)) { value += amount * row.price; known = true; } else partial = true;
      if (!row.assetsAvailable) partial = true;
      for (const token of row.tokens) {
        if (token.status !== 'available' || token.units === null) { partial = true; continue; }
        const tokenAmount = Number(formatTokenUnits(token.units, token.metadata.decimals));
        if (tokenAmount === 0) known = true;
        else if (token.price !== null && Number.isFinite(tokenAmount * token.price)) { value += tokenAmount * token.price; known = true; } else partial = true;
      }
      if (row.collectibles.some(item => item.units !== '0')) partial = true;
    }
    this.state = Object.freeze({ ...next, knownValue: known && Number.isFinite(value) ? value : null, partial: partial || !real.length });
    const published = this.state;
    for (const listener of [...this.listeners]) {
      if (this.state !== published) break;
      if (this.listeners.has(listener)) try { listener(); } catch { /* Public observers cannot interrupt invalidation. */ }
    }
  }
  private context() {
    const state = this.ports.source.getSnapshot(), catalogue = this.ports.source.getCatalogue?.();
    if (!['ready', 'backup-required'].includes(state.phase) || !state.account || !catalogue) return null;
    const id = catalogue.active.accountId;
    // A numeric index in another coin family is not proof of the same account.
    const choices = this.ports.choices().filter(choice => 'kind' in choice.scope.network && choice.scope.network.kind === 'evm' &&
      choice.scope.accountId === id && choice.scope.accountAddress === state.account!.address);
    return { state, catalogue, choices, owner: `${id}:${state.account.address}`, id };
  }
  private synchronize() {
    let current: ReturnType<AccountPortfolioController['context']> = null;
    try { current = this.context(); } catch { /* Full public identity is required. */ }
    if (!current) {
      this.request?.abort(); this.generation++; this.owner = ''; this.cache.clear();
      this.publish({ status: 'unavailable', accountId: null, choices: [], rows: [], refreshing: false });
      return null;
    }
    if (this.owner !== current.owner) {
      this.request?.abort(); this.generation++; this.cache.clear(); this.owner = current.owner;
    }
    const allowed = new Set(current.choices.map(scopeKey));
    for (const [key] of this.cache) if (!allowed.has(key)) this.cache.delete(key);
    const selected = current.choices.filter(choice => this.state.filter === 'all' || choice.scope.network.id === this.state.filter);
    this.publish({ status: this.filterFailed ? 'unavailable' : this.state.filter === null ? 'loading' : 'ready', accountId: current.id, choices: current.choices,
      rows: this.filterFailed ? [] : selected.map(choice => this.cache.get(scopeKey(choice)) ?? this.blank(choice)) });
    return current;
  }
  private blank(choice: NotificationChoice): AccountPortfolioRow {
    return { choice, status: 'unknown', units: null, decimals: 18, updatedAt: null, price: null, tokens: [], collectibles: [], assetsAvailable: false };
  }
  setCurrency(currency: FiatCurrency | null) {
    if (currency === this.state.currency) return;
    this.request?.abort(); this.generation++;
    for (const [key, row] of this.cache) this.cache.set(key, { ...row, price: null, tokens: row.tokens.map(token => ({ ...token, price: null })) });
    this.publish({ currency, rows: this.state.rows.map(row => ({ ...row, price: null, tokens: row.tokens.map(token => ({ ...token, price: null })) })) });
    if (this.connection && this.state.filter !== null) void this.refresh();
  }
  connect = () => {
    this.unsubscribe?.(); this.request?.abort();
    const connection = {}; this.connection = connection;
    const changed = () => { if (this.connection === connection && this.synchronize() && this.state.filter !== null && !this.filterPending && !this.filterFailed) void this.refresh(); };
    this.unsubscribe = this.ports.source.subscribe(changed);
    this.state = { ...empty(), currency: this.state.currency };
    void this.ports.filter.load().then(filter => {
      if (this.connection !== connection) return;
      if (!this.filterPending) this.filterFailed = false;
      this.state = { ...this.state, filter };
      if (this.synchronize()) void this.refresh();
    }).catch(() => { if (this.connection === connection) this.publish({ status: 'unavailable' }); });
    return () => {
      if (this.connection !== connection) return;
      this.connection = null; this.generation++; this.request?.abort(); this.request = null;
      this.unsubscribe?.(); this.unsubscribe = null;
      // Keep only the separately owner-checked source-sheet cache; no detached
      // view may render the departing account's observations.
      this.state = Object.freeze({ ...empty(), status: 'unavailable', filter: this.state.filter, currency: this.state.currency });
    };
  };
  async selectFilter(filter: string) {
    if (!this.connection || filter !== 'all' && !this.state.choices.some(choice => choice.scope.network.id === filter)) return;
    this.request?.abort(); this.generation++;
    const intent = ++this.filterIntent;
    this.filterPending = true;
    try {
      await this.ports.filter.save(filter);
      if (this.filterIntent !== intent) return;
      this.filterPending = false;
      this.filterFailed = false;
      this.state = { ...this.state, filter };
      if (this.connection && this.synchronize()) await this.refresh();
    } catch (error) {
      if (this.filterIntent === intent) {
        this.filterPending = false;
        this.filterFailed = true;
        this.publish({ status: 'unavailable', rows: [], refreshing: false });
      }
      throw error;
    }
  }
  cachedBalances() {
    let current: ReturnType<AccountPortfolioController['context']> = null;
    try { current = this.context(); } catch { return []; }
    if (!current || current.owner !== this.owner) return [];
    return current.choices.flatMap(choice => {
      const row = this.cache.get(scopeKey(choice));
      return row?.status === 'available' && row.units !== null ? [{ networkId: choice.scope.network.id, available: formatBaseUnits(row.units, row.decimals), loading: false }] : [];
    });
  }
  cachedAssets(networkId: string): PortfolioAssets | undefined {
    let current: ReturnType<AccountPortfolioController['context']> = null;
    try { current = this.context(); } catch { return undefined; }
    if (!current || current.owner !== this.owner) return undefined;
    const choice = current.choices.find(value => value.scope.network.id === networkId);
    const row = choice && this.cache.get(scopeKey(choice));
    return row?.assetsAvailable ? { tokens: row.tokens, collectibles: row.collectibles } : undefined;
  }
  refresh = async () => {
    if (!this.connection || this.state.filter === null || this.filterPending || this.filterFailed) return;
    const current = this.synchronize(); if (!current) return;
    this.request?.abort(); const request = new AbortController(); this.request = request;
    const generation = ++this.generation, filter = this.state.filter, currency = this.state.currency;
    const choices = current.choices.filter(choice => filter === 'all' || choice.scope.network.id === filter);
    const check = () => {
      const next = this.context();
      if (!this.connection || this.request !== request || request.signal.aborted || this.generation !== generation ||
          !next || next.owner !== current.owner || next.state.revision !== current.state.revision || this.state.filter !== filter ||
          JSON.stringify(next.choices) !== JSON.stringify(current.choices)) throw Error('CANCELLED');
    };
    this.publish({ refreshing: choices.length > 0 });
    let index = 0;
    const worker = async () => {
      while (index < choices.length && !request.signal.aborted) {
        const choice = choices[index++]!, key = scopeKey(choice), original = this.cache.get(key) ?? this.blank(choice);
        try {
          check(); this.cache.set(key, { ...original, status: 'loading' }); this.synchronize();
          const raw = await this.ports.reader.readBalance(choice.scope.network.id, choice.scope.accountAddress, request.signal);
          if (String(raw.chainId) !== choice.scope.network.chainId) throw Error('Wrong network');
          assertBaseUnits(raw.units); const units = raw.units;
          check();
          this.cache.set(key, { ...original, status: 'available', units, updatedAt: (this.ports.now ?? Date.now)(), price: null, tokens: [], collectibles: [], assetsAvailable: false });
          this.synchronize();
          const testnet = 'testnet' in choice.scope.network && choice.scope.network.testnet;
          const price = !testnet && currency && units !== '0' && this.ports.nativePrice ? await this.ports.nativePrice(choice, currency, request.signal) : null;
          check();
          let assets: PortfolioAssets = { tokens: [], collectibles: [] }, assetsAvailable = false;
          if (this.ports.assets) {
            try { assets = await this.ports.assets(choice.scope, request.signal, check); assetsAvailable = true; } catch { check(); }
          }
          const tokens = [];
          for (const token of assets.tokens) {
            check();
            const tokenPrice = !testnet && currency && token.status === 'available' && token.units !== null && token.units !== '0' && this.ports.tokenPrice
              ? await this.ports.tokenPrice(choice, token.metadata, currency, request.signal) : null;
            tokens.push({ ...token, price: tokenPrice });
          }
          check();
          this.cache.set(key, { choice, status: 'available', units, decimals: original.decimals, updatedAt: (this.ports.now ?? Date.now)(), price, tokens, collectibles: assets.collectibles, assetsAvailable });
          this.synchronize();
        } catch {
          if (request.signal.aborted || this.generation !== generation) return;
          this.cache.set(key, { ...original, status: 'error' }); this.synchronize();
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (this.request === request) { this.request = null; this.publish({ refreshing: false }); }
  };
}
