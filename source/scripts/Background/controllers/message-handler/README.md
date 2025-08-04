# Method Registry System

## Overview

The Method Registry System provides a single source of truth for all RPC methods supported by the Pali wallet. This type-safe, configuration-driven approach eliminates string-based method handling and provides a clear, maintainable way to manage method routing, permissions, and behavior.

## Architecture

### Core Components

1. **Method Registry** (`method-registry.ts`)

   - Central configuration for all methods
   - Defines handler type, permissions, network requirements, and UI routing
   - Type-safe method definitions with comprehensive metadata

2. **Request Pipeline** (`request-pipeline.ts`)

   - Middleware-based processing system
   - Handles authentication, network compatibility, and connection checks
   - Uses enhanced context that flows through all middleware

3. **Method Handlers** (`method-handlers.ts`)

   - Modular handlers for different method types (Wallet, Eth, Sys, Internal)
   - Uses method configuration from registry
   - Handles provider-specific logic

4. **Message Handler** (`index.ts`)
   - Entry point for all messages
   - Routes messages based on method configuration
   - Handles tab ID validation based on method requirements

## Method Configuration

Each method in the registry has the following configuration:

```typescript
interface IMethodConfig {
  // Basic info
  name: string; // Method name
  handlerType: MethodHandlerType; // Which handler processes this method

  // Middleware requirements
  requiresTabId: boolean; // Does this method need a tab ID?
  requiresAuth: boolean; // Does user need to be authenticated?
  requiresConnection: boolean; // Does dApp need to be connected?
  allowHardwareWallet: boolean; // Can hardware wallets use this method?

  // Network requirements
  networkRequirement: NetworkRequirement; // EVM, UTXO, Any, or None

  // UI/Popup configuration
  hasPopup: boolean; // Does this method show a popup?
  popupRoute?: MethodRoute; // Which popup route to use
  popupEventName?: string; // Event name for popup communication

  // Response handling
  returnsArray?: boolean; // Does method return an array?
  cacheKey?: string; // Cache key for provider state
  cacheTTL?: number; // Cache time-to-live in ms

  // Special flags
  isBlocking?: boolean; // Is this a blocking method?
  requiresActiveAccount?: boolean; // Does it need an active account?
}
```

## Middleware System

The pipeline uses middleware for cross-cutting concerns. Each middleware has a single responsibility and uses the method configuration to determine what to check:

1. **Hardware Wallet Middleware**

   - Blocks restricted methods on hardware wallets for UTXO networks
   - Uses `allowHardwareWallet` flag from method config
   - First line of defense for hardware wallet restrictions

2. **Network Compatibility Middleware**

   - Checks if current network type matches method's `networkRequirement`
   - Prompts for network switch if method requires EVM but on UTXO (or vice versa)
   - Only handles network TYPE switching (EVM vs UTXO), not specific chains
   - Respects hybrid dApps that can work with both network types

3. **Connection Middleware**

   - Ensures dApp is connected before executing methods that require it
   - Opens connection popup if needed
   - Router automatically handles authentication if user is logged out
   - Returns connected address for requestAccounts methods

4. **Account Switching Middleware**
   - For blocking methods, ensures the active account matches the connected account
   - Prompts to switch active account if there's a mismatch
   - Only runs for methods marked as `isBlocking` and `requiresConnection`
   - Prevents transaction confusion between multiple accounts

## Adding New Methods

To add a new method:

1. Add the method to `METHOD_REGISTRY` in `method-registry.ts`:

```typescript
'new_method': {
  name: 'new_method',
  handlerType: MethodHandlerType.Wallet, // or Eth, Sys, Internal
  requiresTabId: true,
  requiresAuth: true,
  requiresConnection: true,
  allowHardwareWallet: false,
  networkRequirement: NetworkRequirement.EVM,
  hasPopup: true,
  popupRoute: MethodRoute.NewMethodPopup,
  popupEventName: 'newMethodEvent',
}
```

2. If it needs a popup, add the route to `MethodRoute` enum in `types.ts`

3. Implement the method logic in the appropriate handler

## Benefits

1. **Type Safety**: All methods are typed and validated at compile time
2. **Single Source of Truth**: One place to configure all method behavior
3. **Maintainability**: Easy to see what each method requires and does
4. **Flexibility**: Middleware system allows for easy extension
5. **Security**: Clear permission model for each method
6. **Performance**: Built-in caching for provider state methods
7. **Separation of Concerns**: Each middleware handles one specific aspect

## Migration from Old System

The old system used:

- String-based method matching
- Scattered permission checks
- Duplicate logic across handlers
- Hard-coded special cases

The new system provides:

- Type-safe method registry
- Centralized configuration
- Modular middleware
- Clear separation of concerns
