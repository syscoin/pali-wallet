import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';

import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useController } from 'hooks/useController';
import { usePrice } from 'hooks/usePrice';
import { RootState } from 'state/store';
import { IKeyringAccountState } from 'types/network';
import { formatNumber } from 'utils/index';
import {
  getFreshNativeBalance,
  NATIVE_BALANCE_CACHE_TTL_MS,
} from 'utils/nativeBalanceCache';

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 1000; // 1 second window
const MAX_REQUESTS_PER_WINDOW = 10; // Increased to handle multiple accounts on external screens
const MIN_BATCH_DELAY = 10; // Minimum delay to prevent thundering herd
const MAX_BATCH_DELAY = 100; // Maximum delay to spread out requests

// Global rate limiter and request deduplication
const requestTimestamps: number[] = [];
const pendingRequests = new Map<string, Promise<string>>();

interface ILazyAccountBalanceProps {
  account: IKeyringAccountState;
  accountType?: string;
  className?: string;
  fetchOnMissingBalance?: boolean;
  onBalanceLoad?: (balance: string) => void;
  precision?: number;
  showFiat?: boolean;
  showSkeleton?: boolean;
}

export const LazyAccountBalance: React.FC<ILazyAccountBalanceProps> = ({
  account,
  accountType = '',
  showFiat = true,
  showSkeleton = true,
  className = '',
  fetchOnMissingBalance = true,
  precision = 4,
  onBalanceLoad,
}) => {
  const { controllerEmitter } = useController();
  const { activeNetwork } = useSelector((state: RootState) => state.vault);
  const { getFiatAmount } = usePrice();

  const [balance, setBalance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const freshBalanceEntry = getFreshNativeBalance(account, activeNetwork);
  const freshBalanceUpdatedAt = freshBalanceEntry?.updatedAt;

  // Generate unique key for request deduplication
  const getCacheKey = useCallback(() => {
    const networkKey = `${activeNetwork.kind}-${activeNetwork.chainId}`;
    return `${accountType}-${account.id}-${account.address}-${networkKey}`;
  }, [
    account.address,
    account.id,
    accountType,
    activeNetwork.chainId,
    activeNetwork.kind,
  ]);

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
      // Add timestamp for rate limiting
      requestTimestamps.push(Date.now());

      // Add randomized delay to prevent thundering herd when multiple accounts fetch simultaneously
      const randomDelay =
        Math.floor(Math.random() * (MAX_BATCH_DELAY - MIN_BATCH_DELAY)) +
        MIN_BATCH_DELAY;
      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      // Call the background controller to fetch balance
      return (await controllerEmitter(
        ['wallet', 'getBalanceForAccount'],
        [account, accountType, activeNetwork]
      )) as string;
    })().finally(() => {
      // Keep the request shared across fast popup remounts until it settles.
      // The promise owns its registry entry, not any individual component.
      if (pendingRequests.get(cacheKey) === fetchPromise) {
        pendingRequests.delete(cacheKey);
      }
    });

    // Store the pending request
    pendingRequests.set(cacheKey, fetchPromise);

    return fetchPromise;
  }, [account, accountType, activeNetwork, getCacheKey]);

  // Load balance with rate limiting
  const loadBalance = useCallback(async () => {
    if (!mountedRef.current) return;
    const requestId = ++loadRequestIdRef.current;

    // The legacy balances field has no timestamp, so only short-circuit with
    // the matching network cache entry while it is still fresh.
    const existingBalance = getFreshNativeBalance(
      account,
      activeNetwork
    )?.balance;

    // If balance exists and is not -1 (which means "no data"), use it directly
    if (
      existingBalance !== undefined &&
      existingBalance !== null &&
      existingBalance !== -1
    ) {
      const balanceStr = String(existingBalance);
      setBalance(balanceStr);
      // A targeted Redux update may deliver this value before an in-flight
      // controller request resolves. This branch owns the newest request id,
      // so it must also finish the loading state for the superseded request.
      setIsLoading(false);
      setError(null);
      if (onBalanceLoad) {
        onBalanceLoad(balanceStr);
      }
      return;
    }

    if (!fetchOnMissingBalance) {
      setBalance(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Do not keep rendering a stale value while this request is rate-limited
    // or in flight.
    setBalance(null);
    setIsLoading(true);
    setError(null);

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

    try {
      const balanceValue = await fetchBalance();

      if (!mountedRef.current || requestId !== loadRequestIdRef.current) return;

      setBalance(balanceValue);
      setIsLoading(false);

      if (onBalanceLoad) {
        onBalanceLoad(balanceValue);
      }
    } catch (err) {
      if (!mountedRef.current || requestId !== loadRequestIdRef.current) return;

      setError('Failed to load balance');
      setIsLoading(false);
      setBalance('0'); // Default to 0 on error
    }
  }, [
    account,
    activeNetwork,
    fetchOnMissingBalance,
    getCacheKey,
    canMakeRequest,
    fetchBalance,
    onBalanceLoad,
  ]);

  // Track the actual component lifetime separately from balance refreshes.
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, []);

  // Load on mount and re-read live Redux balances when account data changes.
  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  // Refresh a mounted card when its current cache entry reaches the TTL.
  // This is a single sleeping timeout, not polling, and unmounting the card
  // cancels it before any request can be made.
  useEffect(() => {
    if (freshBalanceUpdatedAt === undefined) return undefined;

    const expiresAt = freshBalanceUpdatedAt + NATIVE_BALANCE_CACHE_TTL_MS;
    let expiryTimeout: ReturnType<typeof setTimeout>;

    const refreshWhenExpired = () => {
      const remaining = expiresAt - Date.now();
      if (remaining > 0) {
        expiryTimeout = setTimeout(refreshWhenExpired, remaining + 1);
        return;
      }

      void loadBalance();
    };

    refreshWhenExpired();

    return () => clearTimeout(expiryTimeout);
  }, [freshBalanceUpdatedAt, loadBalance]);

  // Format balance for display
  const formattedBalance = balance
    ? formatNumber(parseFloat(balance), precision)
    : '0';

  // Get native balance from stored balance
  const nativeBalance = balance ? parseFloat(balance) : 0;

  // Calculate fiat value
  const fiatValue =
    showFiat && nativeBalance > 0 ? getFiatAmount(nativeBalance, 4) : '$0.00';

  const hasFreshBalance = Boolean(freshBalanceEntry);

  const hasMissingBalance = balance === null && !hasFreshBalance;

  // Show a skeleton while a missing or expired value is being fetched.
  const shouldShowSkeleton =
    fetchOnMissingBalance && showSkeleton && (isLoading || hasMissingBalance);

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

  if (!fetchOnMissingBalance && hasMissingBalance) {
    return (
      <div className={className}>
        <p className="text-sm font-medium text-brand-white">--</p>
        {showFiat && <p className="text-xs text-brand-graylight">--</p>}
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
