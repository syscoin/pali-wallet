import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';
import { INetworkType } from '@pollum-io/sysweb3-network';

import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useController } from 'hooks/useController';
import { usePrice } from 'hooks/usePrice';
import { RootState } from 'state/store';
import { formatNumber } from 'utils/index';

// Cache for storing fetched balances with timestamps
interface BalanceCache {
  [key: string]: {
    balance: string;
    timestamp: number;
  };
}

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 1000; // 1 second window
const MAX_REQUESTS_PER_WINDOW = 10; // Increased to handle multiple accounts on external screens
const CACHE_DURATION = 30000; // Cache balances for 30 seconds
const MIN_BATCH_DELAY = 10; // Minimum delay to prevent thundering herd
const MAX_BATCH_DELAY = 100; // Maximum delay to spread out requests

// Global cache and rate limiter
const balanceCache: BalanceCache = {};
const requestTimestamps: number[] = [];
const pendingRequests = new Map<string, Promise<string>>();

interface LazyAccountBalanceProps {
  account: IKeyringAccountState;
  className?: string;
  forceRefresh?: boolean;
  onBalanceLoad?: (balance: string) => void;
  precision?: number;
  showFiat?: boolean;
  showSkeleton?: boolean;
}

export const LazyAccountBalance: React.FC<LazyAccountBalanceProps> = ({
  account,
  showFiat = true,
  showSkeleton = true,
  className = '',
  precision = 4,
  onBalanceLoad,
  forceRefresh = false,
}) => {
  const { controllerEmitter } = useController();
  const { isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { getFiatAmount } = usePrice();

  // Initialize balance from cache if available
  const getCacheKeyInit = () => {
    const networkKey = isBitcoinBased ? 'sys' : `evm-${activeNetwork.chainId}`;
    return `${account.id}-${networkKey}`;
  };

  const cacheKeyInit = getCacheKeyInit();
  const cachedBalance = balanceCache[cacheKeyInit];
  const isCacheValid =
    cachedBalance && Date.now() - cachedBalance.timestamp < CACHE_DURATION;
  const initialBalance = isCacheValid ? cachedBalance.balance : null;

  const [balance, setBalance] = useState<string | null>(initialBalance);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Update balance from cache if component re-renders with null balance
  useEffect(() => {
    const networkKey = isBitcoinBased ? 'sys' : `evm-${activeNetwork.chainId}`;
    const cacheKey = `${account.id}-${networkKey}`;
    const cached = balanceCache[cacheKey];

    if (
      balance === null &&
      cached &&
      Date.now() - cached.timestamp < CACHE_DURATION
    ) {
      setBalance(cached.balance);
    }
  }, [account.id, balance, isBitcoinBased, activeNetwork.chainId]);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Generate cache key for this account and network
  const getCacheKey = useCallback(() => {
    const networkKey = isBitcoinBased ? 'sys' : `evm-${activeNetwork.chainId}`;
    return `${account.id}-${networkKey}`;
  }, [account.id, isBitcoinBased, activeNetwork.chainId]);

  // Check if we can make a request based on rate limiting
  const canMakeRequest = useCallback(() => {
    const now = Date.now();
    // Remove timestamps outside the rate limit window
    const validTimestamps = requestTimestamps.filter(
      (timestamp) => now - timestamp < RATE_LIMIT_WINDOW
    );
    requestTimestamps.length = 0;
    requestTimestamps.push(...validTimestamps);

    return validTimestamps.length < MAX_REQUESTS_PER_WINDOW;
  }, []);

  // Fetch balance from backend
  const fetchBalance = useCallback(async (): Promise<string> => {
    const cacheKey = getCacheKey();

    // Check if there's already a pending request for this account
    if (pendingRequests.has(cacheKey)) {
      return pendingRequests.get(cacheKey)!;
    }

    // Create the fetch promise
    const fetchPromise = (async () => {
      try {
        // Add timestamp for rate limiting
        requestTimestamps.push(Date.now());

        // Add randomized delay to prevent thundering herd when multiple accounts fetch simultaneously
        const randomDelay =
          Math.floor(Math.random() * (MAX_BATCH_DELAY - MIN_BATCH_DELAY)) +
          MIN_BATCH_DELAY;
        await new Promise((resolve) => setTimeout(resolve, randomDelay));

        // Call the background controller to fetch balance
        try {
          const result = await controllerEmitter(
            ['wallet', 'getBalanceForAccount'],
            [account, isBitcoinBased, activeNetwork.url]
          );
          const balanceValue = result as string;

          // Update cache
          balanceCache[cacheKey] = {
            balance: balanceValue,
            timestamp: Date.now(),
          };

          // Clear pending request
          pendingRequests.delete(cacheKey);

          return balanceValue;
        } catch (fetchError) {
          throw fetchError;
        }
      } catch (err) {
        // Clear pending request on error
        pendingRequests.delete(cacheKey);
        throw err;
      }
    })();

    // Store the pending request
    pendingRequests.set(cacheKey, fetchPromise);

    return fetchPromise;
  }, [account, isBitcoinBased, activeNetwork, controllerEmitter, getCacheKey]);

  // Load balance with caching and rate limiting
  const loadBalance = useCallback(async () => {
    if (!mountedRef.current) return;

    // First check if balance is already available in the account object
    const existingBalance = isBitcoinBased
      ? account.balances?.syscoin
      : account.balances?.ethereum;

    // If balance exists and is not -1 (which means "no data"), use it directly
    if (
      existingBalance !== undefined &&
      existingBalance !== null &&
      existingBalance !== -1
    ) {
      const balanceStr = String(existingBalance);
      setBalance(balanceStr);
      if (onBalanceLoad) {
        onBalanceLoad(balanceStr);
      }
      return;
    }

    const cacheKey = getCacheKey();

    // Check cache first (unless force refresh is requested)
    if (!forceRefresh && balanceCache[cacheKey]) {
      const cached = balanceCache[cacheKey];
      const isExpired = Date.now() - cached.timestamp > CACHE_DURATION;

      if (!isExpired) {
        setBalance(cached.balance);
        if (onBalanceLoad) {
          onBalanceLoad(cached.balance);
        }
        return;
      }
    }

    // Check rate limiting
    if (!canMakeRequest()) {
      // Schedule a retry after the rate limit window
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }

      fetchTimeoutRef.current = setTimeout(() => {
        loadBalance();
      }, RATE_LIMIT_WINDOW);

      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const balanceValue = await fetchBalance();

      // Always update state since components remount quickly on external screens
      setBalance(balanceValue);
      setIsLoading(false);

      if (onBalanceLoad) {
        onBalanceLoad(balanceValue);
      }
    } catch (err) {
      console.error('Failed to fetch balance:', err);
      setError('Failed to load balance');
      setIsLoading(false);
      setBalance('0'); // Default to 0 on error
    }
  }, [
    account.balances,
    isBitcoinBased,
    getCacheKey,
    forceRefresh,
    canMakeRequest,
    fetchBalance,
    onBalanceLoad,
  ]);

  // Load balance on mount or when dependencies change
  useEffect(() => {
    loadBalance();
    return () => {
      mountedRef.current = false;
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [loadBalance]);

  // Format balance for display
  const formattedBalance = balance
    ? formatNumber(parseFloat(balance), precision)
    : '0';

  // Get native balance from stored balance
  const nativeBalance = balance ? parseFloat(balance) : 0;

  // Calculate fiat value
  const fiatValue =
    showFiat && nativeBalance > 0 ? getFiatAmount(nativeBalance, 4) : '$0.00';

  // Show skeleton if loading OR if we don't have a balance yet (and existing balance is -1)
  const shouldShowSkeleton =
    showSkeleton &&
    (isLoading ||
      (balance === null &&
        (account.balances?.ethereum === -1 ||
          account.balances?.syscoin === -1)));

  if (shouldShowSkeleton) {
    return (
      <div className={className}>
        <SkeletonLoader width="80px" height="20px" />
        {showFiat && (
          <SkeletonLoader width="60px" height="16px" className="mt-1" />
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <p className="text-sm font-medium text-brand-white">--</p>
        {showFiat && <p className="text-xs text-brand-graylight">--</p>}
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="text-sm font-medium text-brand-white whitespace-nowrap">
        {formattedBalance} {activeNetwork.currency?.toUpperCase() || 'SYS'}
      </p>
      {showFiat && (
        <p className="text-xs text-brand-graylight whitespace-nowrap">
          {fiatValue}
        </p>
      )}
    </div>
  );
};
