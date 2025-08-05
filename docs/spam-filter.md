# Spam Filter and Blacklist Implementation

## Overview

Pali Wallet implements two security mechanisms to protect users:

1. **Spam Filter**: Detects and blocks dapps that send excessive popup requests
2. **Blacklist Service**: Checks addresses and URLs against known malicious entities

## Blacklist Service

### Non-Blocking Implementation

The blacklist service now uses a **non-blocking approach** similar to MetaMask:

- `checkAddress()` and `checkUrl()` trigger data loading in the background but don't wait
- Checks run immediately against whatever data is in memory
- Prevents UI freezes when blacklist data expires (24-hour refresh cycle)

### Behavior

1. **On Fresh Start**: 
   - Returns `isBlacklisted: false` until data loads
   - Data loading triggered by first check or startup initialization

2. **During Normal Operation**:
   - Uses cached data for instant checks
   - Background refresh every 24 hours
   - No blocking during refresh

3. **Data Safety**:
   - No crash risk - JavaScript is single-threaded
   - `isFetching` flag prevents duplicate fetches
   - Worst case: checking against empty/stale data

### Helper Methods

```typescript
// Check if data is loaded (useful for UI indicators)
blacklistService.isDataLoaded(): boolean

// Get last fetch timestamp
blacklistService.getLastFetchTime(): number
```

## Spam Filter

The spam filter tracks popup requests per dapp and shows warnings after a threshold:

1. Counts requests that would open popups
2. Shows warning after threshold (configurable)
3. User can choose to block the dapp temporarily
4. Blocked dapps receive error code 4100

## Security Trade-offs

**Pros of non-blocking approach:**
- No UI freezes
- Better user experience
- Immediate transaction flow

**Cons:**
- May miss newly added malicious addresses/URLs during first ~10 seconds after startup
- Relies on initial data load completing quickly

This approach prioritizes UX while maintaining security through:
- Quick startup initialization (1 second delay)
- HTTP caching to minimize fetch time
- Background refresh to keep data current