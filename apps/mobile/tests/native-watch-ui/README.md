# Native / watch account browser fixture

This entry renders the production `App.tsx`, `NativeWallet.native.tsx`, unified account chooser, and public portfolio. Metro redirects only platform persistence, native runtime creation and privacy shielding to explicit test adapters. These adapters contain synthetic public accounts, in-memory custody/transfer storage, and deterministic RPC responses. They never use live funds, device secrets, network RPCs, or the production native store.

The fixture runs React Native Web at 390x844 and controls lifecycle events through a test hook. `Platform.OS` is set to iOS so the real native navigation branches render. The native custody and transfer controllers are production implementations; SDK ports use a password accepted only by this synthetic runtime. No transaction can broadcast.

Run from `apps/mobile`:

```sh
node scripts/build-native-watch-ui.cjs
npx playwright test --config playwright.watch.config.ts
```

The browser suite checks authority transitions, pending-operation revocation, persistent public management, public-store failures, explicit watch-only affordances, address copy, and large-text layout. These are synthetic browser component checks; device Keychain, Android Keystore, SQLCipher, native capture protection and physical-device behavior require their separate native qualification procedures.
