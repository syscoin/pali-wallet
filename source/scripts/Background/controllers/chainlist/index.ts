import { INetworkType } from '@pollum-io/sysweb3-network';

interface IChainInfo {
  chain: INetworkType;
  chainId: number;
  chainSlug?: string;
  explorers?: Array<{
    name: string;
    standard?: string;
    url: string;
  }>;
  icon?: string;
  infoURL?: string;
  name: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  networkId: number;
  rpc: Array<{
    isOpenSource?: boolean;
    tracking?: string;
    url: string;
  }>;
  shortName?: string;
}

class ChainListService {
  private static instance: ChainListService;
  private chainData: IChainInfo[] | null = null;
  private lastFetchTime = 0;
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private readonly CHAINLIST_URL = 'https://chainlist.org/rpcs.json';
  private readonly STORAGE_KEY = 'chainlist_data_cache';
  private fetchPromise: Promise<IChainInfo[]> | null = null;

  private constructor() {
    // Private constructor for singleton pattern
  }

  static getInstance(): ChainListService {
    if (!ChainListService.instance) {
      ChainListService.instance = new ChainListService();
    }
    return ChainListService.instance;
  }

  async initialize(): Promise<void> {
    // Try to load from cache first
    try {
      const cached = await this.loadFromCache();
      if (cached && this.isCacheValid(cached.timestamp)) {
        this.chainData = cached.data;
        this.lastFetchTime = cached.timestamp;
        console.log('[ChainListService] Loaded chain data from cache');
      } else {
        // Fetch in background if cache is stale
        this.fetchInBackground();
      }
    } catch (error) {
      console.error('[ChainListService] Error loading from cache:', error);
      this.fetchInBackground();
    }
  }

  private async loadFromCache(): Promise<{
    data: IChainInfo[];
    timestamp: number;
  } | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get(this.STORAGE_KEY, (result) => {
        if (result[this.STORAGE_KEY]) {
          resolve(result[this.STORAGE_KEY]);
        } else {
          resolve(null);
        }
      });
    });
  }

  private async saveToCache(
    data: IChainInfo[],
    timestamp: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(
        {
          [this.STORAGE_KEY]: { data, timestamp },
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              '[ChainListService] Failed to save chain data to cache:',
              chrome.runtime.lastError.message
            );
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          console.log(
            '[ChainListService] Successfully saved chain data to cache'
          );
          resolve();
        }
      );
    });
  }

  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.CACHE_DURATION;
  }

  private fetchInBackground(): void {
    // Don't fetch if already fetching
    if (this.fetchPromise) return;

    console.log('[ChainListService] Fetching chain data in background...');
    this.fetchData().catch((error) => {
      console.error('[ChainListService] Background fetch failed:', error);
    });
  }

  async fetchData(): Promise<IChainInfo[]> {
    // Return existing promise if already fetching
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = this._fetchData();

    try {
      const result = await this.fetchPromise;
      return result;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async _fetchData(): Promise<IChainInfo[]> {
    try {
      const response = await fetch(this.CHAINLIST_URL, {
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch chain data: ${response.status}`);
      }

      const data: IChainInfo[] = await response.json();

      // Validate data
      if (!Array.isArray(data)) {
        throw new Error('Invalid chain data format');
      }

      // Cache the data
      this.chainData = data;
      this.lastFetchTime = Date.now();
      await this.saveToCache(data, this.lastFetchTime);

      console.log(`[ChainListService] Fetched ${data.length} chains`);
      return data;
    } catch (error) {
      console.error('[ChainListService] Error fetching chain data:', error);
      throw error;
    }
  }

  async getChainData(): Promise<IChainInfo[]> {
    // If we have valid cached data, return it
    if (this.chainData && this.isCacheValid(this.lastFetchTime)) {
      return this.chainData;
    }

    // Otherwise fetch fresh data
    return this.fetchData();
  }

  async searchChains(query: string): Promise<IChainInfo[]> {
    const chains = await this.getChainData();
    const lowerQuery = query.toLowerCase();

    return chains.filter(
      (chain) =>
        chain.name.toLowerCase().includes(lowerQuery) ||
        chain.chainId.toString().includes(query) ||
        chain.shortName?.toLowerCase().includes(lowerQuery) ||
        chain.nativeCurrency.symbol.toLowerCase().includes(lowerQuery)
    );
  }

  async getChainById(chainId: number): Promise<IChainInfo | undefined> {
    const chains = await this.getChainData();
    return chains.find((chain) => chain.chainId === chainId);
  }
}

export default ChainListService;
export type { IChainInfo as ChainInfo };
