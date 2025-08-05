# Asset Management Test Suite

Comprehensive test coverage for Pali Wallet's asset management system, covering all asset types (tokens, NFTs, UTXOs) across different networks with robust error handling.

## Test Structure

### 1. Unit Tests

#### `assetManagement.test.ts`

Core asset management functionality tests:

- **EVM Asset Management**
  - Token discovery via Blockscout API
  - Balance updates for ERC-20, ERC-721, ERC-1155
  - Token addition and validation
  - Support for ERC-777 and ERC-4626 tokens
- **UTXO/Syscoin Asset Management**
  - SPT token discovery from blockbook
  - Token details fetching
  - Balance calculations with proper decimals
- **NFT Management**

  - Multi-standard NFT detection
  - NFT merging and deduplication
  - Collection handling for ERC-1155

- **Network Scenarios**

  - Network switching (EVM ↔ UTXO)
  - Handling network failures and timeouts
  - Operations without API endpoints
  - Rate limiting and retry logic

- **Edge Cases**
  - Missing metadata handling
  - Very large balance handling
  - Duplicate token prevention

### 2. Component Tests

#### `assetDisplay.test.tsx`

UI component testing:

- **NFT Display**
  - Details rendering
  - Image fallback handling
  - External link navigation
  - Copy functionality
- **Token Lists**
  - Balance formatting
  - Loading states
  - Empty states
  - Market data display
- **Network-specific UI**

  - Chain icons
  - Explorer links
  - Network-specific formatting

- **Accessibility**
  - ARIA labels
  - Keyboard navigation
  - Screen reader support

### 3. Transaction Tests

#### `assetSending.test.ts`

Asset sending functionality:

- **EVM Transactions**
  - Native ETH sending
  - ERC-20 token transfers
  - NFT transfers (ERC-721, ERC-1155)
  - Gas estimation and EIP-1559
- **UTXO Transactions**
  - Native SYS sending
  - SPT token allocations
  - UTXO selection and change
  - Dust output handling
- **Transaction Monitoring**
  - Confirmation polling
  - Failed transaction handling
  - User rejection scenarios

### 4. Integration Tests

#### `assetIntegration.test.ts`

End-to-end scenarios:

- **Complete Lifecycles**
  - Add → Update → Send → Remove token flow
  - NFT detection → Send → Update flow
- **Multi-network Operations**
  - Network switching with asset updates
  - Concurrent updates across networks
- **Error Recovery**
  - API failure recovery
  - Partial update handling
- **Performance**
  - Batch update optimization
  - Request deduplication
- **State Consistency**
  - Rapid network switches
  - Account switches with pending updates
- **Security**
  - Address validation
  - Metadata sanitization
- **Offline Support**
  - Cache usage
  - Operation queuing

## Running Tests

### Run all asset tests:

```bash
npm test -- --config=tests/assets/jest.config.js
```

### Run specific test file:

```bash
npm test -- tests/assets/assetManagement.test.ts
```

### Run with coverage:

```bash
npm test -- --config=tests/assets/jest.config.js --coverage
```

### Run in watch mode:

```bash
npm test -- --config=tests/assets/jest.config.js --watch
```

## Mock Data

The test suite includes comprehensive mock data for:

- EVM networks (Ethereum, Polygon, BSC)
- UTXO networks (Syscoin, Bitcoin)
- Various token standards (ERC-20, ERC-721, ERC-1155, ERC-777, ERC-4626)
- SPT tokens
- NFT collections
- Transaction responses
- API responses (success and failure cases)

## Coverage Goals

The test suite aims for:

- **80%+ code coverage** for all asset-related modules
- **100% coverage** for critical paths (sending, balance updates)
- **Edge case coverage** for error scenarios
- **Integration coverage** for user workflows

## Key Testing Patterns

### 1. API Mocking

```typescript
global.fetch = jest.fn().mockResolvedValueOnce({
  ok: true,
  status: 200,
  json: async () => mockApiResponse,
});
```

### 2. Redux Store Mocking

```typescript
const mockStore = configureStore({
  reducer: {
    vault: (s = mockState.vault) => s,
  },
});
```

### 3. Async Testing

```typescript
await waitFor(() => {
  expect(mockFunction).toHaveBeenCalled();
});
```

### 4. Error Simulation

```typescript
jest.fn().mockRejectedValueOnce(new Error('Network error'));
```

## Continuous Integration

These tests are designed to run in CI/CD pipelines:

- Fast execution (< 2 minutes for full suite)
- Deterministic results (no flaky tests)
- Parallel execution support
- Clear failure reporting

## Maintenance

When adding new asset features:

1. Add unit tests for new functions
2. Add component tests for new UI
3. Update integration tests for new flows
4. Ensure coverage thresholds are met
5. Document any new mock patterns

## Troubleshooting

### Common Issues:

- **Timeout errors**: Increase `testTimeout` in jest.config.js
- **Module not found**: Check `moduleNameMapper` paths
- **React errors**: Ensure proper component wrapping with providers
- **Async errors**: Use `waitFor` for async state updates
