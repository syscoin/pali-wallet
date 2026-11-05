import { INetworkType } from '@sidhujag/sysweb3-network';
import { coins as utxoCoins, retryableFetch } from '@sidhujag/sysweb3-network';

import {
  EVM_CHAIN_CATALOGUE_URL,
  parseEvmChainCatalogue,
} from '../../../../shared/chainCatalogueData';
import { chromeStorage } from 'utils/storageAPI';

import type { ChainInfo } from '../../../../shared/chainCatalogue';

class ChainListService {
  private static instance: ChainListService;
  private chainData: ChainInfo[] | null = null;
  private utxoChainData: ChainInfo[] | null = null;
  private lastFetchTime = 0;
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private readonly STORAGE_KEY = 'chainlist_data_cache';
  private fetchPromise: Promise<ChainInfo[]> | null = null;

  private constructor() {
    // Private constructor for singleton pattern
  }

  static getInstance(): ChainListService {
    if (!ChainListService.instance) {
      ChainListService.instance = new ChainListService();
    }
    return ChainListService.instance;
  }

  async initialize(networkType?: INetworkType): Promise<void> {
    // Only initialize what's needed based on network type
    if (networkType === INetworkType.Syscoin) {
      // Only initialize UTXO chains
      if (!this.utxoChainData) {
        this.initializeUTXOChains();
      }
      return;
    }

    if (networkType === INetworkType.Ethereum || !networkType) {
      // Initialize EVM chains (or both if no type specified)
      try {
        const cached = await this.loadFromCache();
        if (cached && this.isCacheValid(cached.timestamp)) {
          this.chainData = cached.data;
          this.lastFetchTime = cached.timestamp;
          console.log('[ChainListService] Loaded EVM chain data from cache');
        } else {
          // Fetch in background if cache is stale
          this.fetchInBackground();
        }
      } catch (error) {
        console.error(
          '[ChainListService] Error loading EVM chains from cache:',
          error
        );
        this.fetchInBackground();
      }
    }

    // Initialize UTXO chains only if no network type specified (backward compatibility)
    if (!networkType && !this.utxoChainData) {
      this.initializeUTXOChains();
    }
  }

  private initializeUTXOChains(): void {
    // Convert UTXO coins to ChainInfo format
    this.utxoChainData = utxoCoins
      .filter(
        (coin) =>
          coin.blockchainLink &&
          coin.blockchainLink.url &&
          coin.blockchainLink.url.length > 0
      )
      .map((coin) => {
        // Map coin data to ChainInfo format
        const rpcUrls = Array.isArray(coin.blockchainLink!.url)
          ? coin.blockchainLink!.url
          : [coin.blockchainLink!.url];

        // Generate dynamic icon name using coin properties
        const getIconName = (coinData: any): string => {
          // Use coin name as primary identifier (most universal)
          const coinName =
            coinData.coinName?.toLowerCase().replace(/\s+/g, '') || '';
          const coinLabel =
            coinData.coinLabel?.toLowerCase().replace(/\s+/g, '') || '';
          const shortcut = coinData.shortcut?.toLowerCase() || '';
          const coinShortcut = coinData.coinShortcut?.toLowerCase() || '';

          // Return the most descriptive identifier
          return coinName || coinLabel || shortcut || coinShortcut;
        };

        // Consistent chainId assignment: use slip44 (same as constants.ts)
        const chainId = coin.chainId || coin.slip44;

        return {
          chain: INetworkType.Syscoin,
          chainId,
          chainSlug: coin.shortcut?.toLowerCase(),
          explorers: rpcUrls.map((url) => ({
            name: coin.name,
            standard: 'blockbook',
            url: url,
          })),
          icon: getIconName(coin),
          name: coin.name || coin.coinLabel,
          nativeCurrency: {
            decimals: coin.decimals,
            name: coin.coinName,
            symbol: coin.coinShortcut || coin.shortcut || '',
          },
          networkId: chainId,
          rpc: rpcUrls.map((url) => ({
            isOpenSource: true,
            tracking: 'none',
            url: url,
          })),
          shortName: coin.shortcut,
          // Additional UTXO fields - preserve original slip44
          slip44: coin.slip44,
          coinLabel: coin.coinLabel,
          coinShortcut: coin.coinShortcut,
        };
      });

    console.log(
      `[ChainListService] Initialized ${this.utxoChainData.length} UTXO chains`
    );
  }

  private async loadFromCache(): Promise<{
    data: ChainInfo[];
    timestamp: number;
  } | null> {
    try {
      const result = await chromeStorage.getItem(this.STORAGE_KEY);
      return result || null;
    } catch (error) {
      console.error('[ChainListService] Failed to load from cache:', error);
      return null;
    }
  }

  private async saveToCache(
    data: ChainInfo[],
    timestamp: number
  ): Promise<void> {
    try {
      await chromeStorage.setItem(this.STORAGE_KEY, { data, timestamp });
      console.log('[ChainListService] Successfully saved chain data to cache');
    } catch (error) {
      console.error(
        '[ChainListService] Failed to save chain data to cache:',
        error
      );
      throw error;
    }
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

  async fetchData(): Promise<ChainInfo[]> {
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

  private async _fetchData(): Promise<ChainInfo[]> {
    try {
      const response = await retryableFetch(EVM_CHAIN_CATALOGUE_URL, {
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch chain data: ${response.status}`);
      }

      const data = parseEvmChainCatalogue(await response.json());

      // Cache the transformed data
      this.chainData = data;
      this.lastFetchTime = Date.now();
      await this.saveToCache(data, this.lastFetchTime);

      console.log(
        `[ChainListService] Fetched and transformed ${data.length} chains`
      );
      return data;
    } catch (error) {
      console.error('[ChainListService] Error fetching chain data:', error);
      throw error;
    }
  }

  async getChainData(networkType?: INetworkType): Promise<ChainInfo[]> {
    // If network type is specified, only load that type
    if (networkType === INetworkType.Syscoin) {
      // Only load UTXO chains
      if (!this.utxoChainData) {
        this.initializeUTXOChains();
      }
      return this.utxoChainData || [];
    } else if (networkType === INetworkType.Ethereum) {
      // Only load EVM chains
      if (!this.chainData || !this.isCacheValid(this.lastFetchTime)) {
        await this.initialize(INetworkType.Ethereum);
        // If still no data after init, fetch it
        if (!this.chainData) {
          return await this.fetchData();
        }
      }
      return this.chainData || [];
    }
    return [];
  }

  async searchChains(
    query: string,
    networkType?: INetworkType
  ): Promise<ChainInfo[]> {
    // Only load chains for the specified network type
    const chains = await this.getChainData(networkType);
    const lowerQuery = query.toLowerCase();

    return chains.filter(
      (chain) =>
        chain.name.toLowerCase().includes(lowerQuery) ||
        chain.chainId.toString().includes(query) ||
        chain.shortName?.toLowerCase().includes(lowerQuery) ||
        chain.nativeCurrency.symbol.toLowerCase().includes(lowerQuery) ||
        chain.coinLabel?.toLowerCase().includes(lowerQuery) ||
        chain.coinShortcut?.toLowerCase().includes(lowerQuery)
    );
  }

  async getChainById(
    chainId: number,
    networkType?: INetworkType
  ): Promise<ChainInfo | undefined> {
    // Only load chains for the specified network type
    const chains = await this.getChainData(networkType);
    return chains.find((chain) => chain.chainId === chainId);
  }
}

export default ChainListService;
export type { ChainInfo };
