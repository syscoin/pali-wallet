import axios from 'axios';

/**
 * Blacklist Service for Pali Wallet - Memory-Only Implementation
 *
 * This service manages security lists entirely in memory:
 * 1. Address blacklists - Known malicious EVM addresses with reasons
 * 2. URL blacklists - Known phishing domains with descriptions
 * 3. Fuzzylist - Legitimate sites for similarity detection
 *
 * Memory Strategy:
 * - Data is stored only in memory (no chrome.storage usage)
 * - Service worker may terminate after ~30 seconds of inactivity
 * - Data is re-fetched when service worker restarts
 * - Uses HTTP caching headers to minimize network requests
 * - Fetches are throttled to prevent excessive API calls
 *
 * Data Sources:
 * - MEW blacklists include detailed comments explaining why each entry is blocked
 * - MetaMask phishing detector provides domain lists
 * - All reasons/comments are preserved and shown to users
 */

// Simple types since we don't store metadata
interface IBlacklistCheckResult {
  isBlacklisted: boolean;
  reason?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

class BlacklistService {
  // In-memory caches - cleared when service worker terminates
  private addressBlacklist: Map<string, string> = new Map(); // address -> comment
  private urlBlacklist: Map<string, string> = new Map(); // url -> comment
  private urlWhitelist: Set<string> = new Set();
  private legitimateSites: string[] = []; // For fuzzy matching

  private lastFetch: number = 0;
  private REFETCH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  private isFetching = false;

  // Cache axios instances with proper headers
  private axiosInstance = axios.create({
    timeout: 10000,
    headers: {
      'Cache-Control': 'max-age=1800', // 30 min browser cache
    },
  });

  // Local known malicious domains (previously mistakenly marked as "trusted")
  private readonly LOCAL_MALICIOUS_DOMAINS = [
    {
      url: 'cryptotitties.com',
      reason: 'Phishing: Impersonates CryptoKitties (cryptokitties.co)',
    },
    {
      url: 'cryptoshitties.co',
      reason: 'Phishing: Malicious parody of CryptoKitties',
    },
    {
      url: 'cryptotitties.fun',
      reason: 'Phishing: Impersonates CryptoKitties (cryptokitties.co)',
    },
    {
      url: 'metmask.com',
      reason: 'Phishing: Impersonates MetaMask (missing letter a)',
    },
    {
      url: 'myethlerwallet.com',
      reason: 'Phishing: Impersonates MyEtherWallet (typo in name)',
    },
    { url: 'metatask.io', reason: 'Phishing: Impersonates MetaMask wallet' },
    { url: 'metamaks.ru', reason: 'Phishing: Impersonates MetaMask wallet' },
    { url: 'metamast.com', reason: 'Phishing: Impersonates MetaMask wallet' },
    { url: 'metamax.io', reason: 'Phishing: Impersonates MetaMask wallet' },
  ] as const;

  // Public blacklist sources
  private readonly BLACKLIST_SOURCES = {
    MEW_ADDRESSES:
      'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json',
    MEW_URLS:
      'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json',
    METAMASK_PHISHING:
      'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
    SCAMSNIFFER_ADDRESSES:
      'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
    SCAMSNIFFER_DOMAINS:
      'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
  };

  async initialize() {
    console.log(
      '[BlacklistService] Initializing memory-only blacklist service'
    );
    await this.ensureDataLoaded();
  }

  private async ensureDataLoaded() {
    // Check if we need to fetch data
    const now = Date.now();
    const dataExpired = now - this.lastFetch > this.REFETCH_INTERVAL;
    const noData =
      this.addressBlacklist.size === 0 && this.urlBlacklist.size === 0;

    if ((dataExpired || noData) && !this.isFetching) {
      await this.fetchAllBlacklists();
    }
  }

  private async fetchAllBlacklists() {
    if (this.isFetching) return;
    this.isFetching = true;

    console.log('[BlacklistService] Fetching blacklists from sources');

    try {
      // Fetch all sources in parallel
      const [
        mewAddresses,
        mewUrls,
        metamaskConfig,
        scamSnifferAddresses,
        scamSnifferDomains,
      ] = await Promise.allSettled([
        this.axiosInstance.get(this.BLACKLIST_SOURCES.MEW_ADDRESSES),
        this.axiosInstance.get(this.BLACKLIST_SOURCES.MEW_URLS),
        this.axiosInstance.get(this.BLACKLIST_SOURCES.METAMASK_PHISHING),
        this.axiosInstance.get(this.BLACKLIST_SOURCES.SCAMSNIFFER_ADDRESSES),
        this.axiosInstance.get(this.BLACKLIST_SOURCES.SCAMSNIFFER_DOMAINS),
      ]);

      // Clear existing data
      this.addressBlacklist.clear();
      this.urlBlacklist.clear();
      this.urlWhitelist.clear();

      // Process MEW addresses
      if (
        mewAddresses.status === 'fulfilled' &&
        Array.isArray(mewAddresses.value.data)
      ) {
        mewAddresses.value.data.forEach((entry: any) => {
          if (entry.address) {
            this.addressBlacklist.set(
              entry.address.toLowerCase(),
              entry.comment || 'Blacklisted address'
            );
          }
        });
        console.log(
          `[BlacklistService] Loaded ${this.addressBlacklist.size} blacklisted addresses`
        );
      }

      // Process MEW URLs
      if (mewUrls.status === 'fulfilled' && Array.isArray(mewUrls.value.data)) {
        mewUrls.value.data.forEach((entry: any) => {
          if (entry.id) {
            // MEW uses 'id' field for the URL
            this.urlBlacklist.set(
              this.normalizeUrl(entry.id),
              entry.comment || 'Blacklisted domain'
            );
          }
        });
      }

      // Process MetaMask config
      if (metamaskConfig.status === 'fulfilled' && metamaskConfig.value.data) {
        const config = metamaskConfig.value.data;

        // Add blacklisted domains
        if (Array.isArray(config.blacklist)) {
          config.blacklist.forEach((domain: string) => {
            this.urlBlacklist.set(
              this.normalizeUrl(domain),
              'MetaMask phishing detector: Known phishing site'
            );
          });
        }

        // Store whitelist
        if (Array.isArray(config.whitelist)) {
          config.whitelist.forEach((domain: string) => {
            this.urlWhitelist.add(this.normalizeUrl(domain));
          });
        }

        // Store fuzzylist for similarity detection
        if (Array.isArray(config.fuzzylist)) {
          this.legitimateSites = config.fuzzylist.map((domain: string) =>
            this.normalizeUrl(domain)
          );
        }

        console.log(
          `[BlacklistService] Loaded ${this.urlBlacklist.size} blacklisted URLs, ${this.legitimateSites.length} legitimate sites for fuzzy matching`
        );
      }

      // Add local malicious domains
      this.LOCAL_MALICIOUS_DOMAINS.forEach((entry) => {
        this.urlBlacklist.set(this.normalizeUrl(entry.url), entry.reason);
      });

      // Process Scam Sniffer addresses
      if (
        scamSnifferAddresses.status === 'fulfilled' &&
        Array.isArray(scamSnifferAddresses.value.data)
      ) {
        scamSnifferAddresses.value.data.forEach((address: string) => {
          if (address) {
            this.addressBlacklist.set(
              address.toLowerCase(),
              'Scam Sniffer: Known malicious address'
            );
          }
        });
        console.log(
          `[BlacklistService] Loaded ${scamSnifferAddresses.value.data.length} addresses from Scam Sniffer`
        );
      }

      // Process Scam Sniffer domains
      if (
        scamSnifferDomains.status === 'fulfilled' &&
        Array.isArray(scamSnifferDomains.value.data)
      ) {
        scamSnifferDomains.value.data.forEach((domain: string) => {
          if (domain) {
            this.urlBlacklist.set(
              this.normalizeUrl(domain),
              'Scam Sniffer: Known phishing domain'
            );
          }
        });
        console.log(
          `[BlacklistService] Loaded ${scamSnifferDomains.value.data.length} domains from Scam Sniffer`
        );
      }

      console.log(
        `[BlacklistService] Total loaded: ${this.addressBlacklist.size} addresses, ${this.urlBlacklist.size} domains`
      );

      this.lastFetch = Date.now();
    } catch (error) {
      console.error('[BlacklistService] Error fetching blacklists:', error);
    } finally {
      this.isFetching = false;
    }
  }

  private normalizeUrl(url: string): string {
    return url
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  }

  async checkAddress(address: string): Promise<IBlacklistCheckResult> {
    await this.ensureDataLoaded();

    const normalized = address.toLowerCase();
    const comment = this.addressBlacklist.get(normalized);

    if (comment) {
      return {
        isBlacklisted: true,
        reason: comment,
        severity: 'high', // Default high for any blacklisted address
      };
    }

    return {
      isBlacklisted: false,
      severity: 'low',
    };
  }

  async checkUrl(url: string): Promise<IBlacklistCheckResult> {
    await this.ensureDataLoaded();

    const normalized = this.normalizeUrl(url);

    // Check whitelist first
    if (this.urlWhitelist.has(normalized)) {
      return {
        isBlacklisted: false,
        severity: 'low',
      };
    }

    // Check exact blacklist match
    const exactMatch = this.urlBlacklist.get(normalized);
    if (exactMatch) {
      return {
        isBlacklisted: true,
        reason: exactMatch,
        severity: 'critical',
      };
    }

    // Check if it's a subdomain of a blacklisted domain
    const parts = normalized.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const domain = parts.slice(i).join('.');
      const domainMatch = this.urlBlacklist.get(domain);
      if (domainMatch) {
        return {
          isBlacklisted: true,
          reason: `Subdomain of blacklisted domain (${domain}): ${domainMatch}`,
          severity: 'high',
        };
      }
    }

    // Check fuzzy matching
    const fuzzyMatch = this.checkFuzzyMatch(normalized);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }

    return {
      isBlacklisted: false,
      severity: 'low',
    };
  }

  private checkFuzzyMatch(url: string): IBlacklistCheckResult | null {
    // Don't check if URL is in legitimate sites
    if (this.legitimateSites.includes(url)) {
      return null;
    }

    const urlParts = url.split('.');
    const urlDomain = urlParts[0];

    for (const legitSite of this.legitimateSites) {
      const legitParts = legitSite.split('.');
      const legitDomain = legitParts[0];

      // Quick length check
      if (Math.abs(urlDomain.length - legitDomain.length) > 3) continue;

      // Check for common phishing patterns
      const similarity = this.calculateSimilarity(urlDomain, legitDomain);

      if (similarity > 0.8 && similarity < 1) {
        return {
          isBlacklisted: true,
          reason: `Suspiciously similar to ${legitSite}`,
          severity: similarity > 0.9 ? 'high' : 'medium',
        };
      }

      // Check character substitution patterns
      if (this.checkCharacterSubstitution(urlDomain, legitDomain)) {
        return {
          isBlacklisted: true,
          reason: `Deceptive variation of ${legitSite}`,
          severity: 'high',
        };
      }
    }

    return null;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const distance = this.levenshteinDistance(str1, str2);
    return 1 - distance / Math.max(str1.length, str2.length);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }

    return dp[m][n];
  }

  private checkCharacterSubstitution(
    test: string,
    legitimate: string
  ): boolean {
    // Normalize common substitutions
    const normalize = (s: string) =>
      s
        .replace(/[0o]/gi, '0')
        .replace(/[1il]/gi, '1')
        .replace(/[s5]/gi, '5')
        .replace(/-/g, '');

    return normalize(test) === normalize(legitimate) && test !== legitimate;
  }

  // Get current status
  getStatus(): {
    addressCount: number;
    cacheExpiry: Date | null;
    isLoaded: boolean;
    lastFetch: Date | null;
    urlCount: number;
  } {
    return {
      isLoaded: this.addressBlacklist.size > 0 || this.urlBlacklist.size > 0,
      addressCount: this.addressBlacklist.size,
      urlCount: this.urlBlacklist.size,
      lastFetch: this.lastFetch ? new Date(this.lastFetch) : null,
      cacheExpiry: this.lastFetch
        ? new Date(this.lastFetch + this.REFETCH_INTERVAL)
        : null,
    };
  }

  // Force refresh data
  async forceRefresh() {
    this.lastFetch = 0;
    await this.ensureDataLoaded();
  }
}

export const blacklistService = new BlacklistService();
