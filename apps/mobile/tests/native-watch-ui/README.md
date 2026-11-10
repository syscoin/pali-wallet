# Native / watch account browser fixture

This entry renders the production `App.tsx`, `NativeWallet.native.tsx`, unified account chooser, and public portfolio. Metro redirects only platform persistence, native runtime creation and privacy shielding to explicit test adapters. These adapters contain synthetic public accounts, in-memory custody/transfer storage, and deterministic RPC responses. They never use live funds, device secrets, network RPCs, or the production native store.

The fixture runs React Native Web at 390x844 and controls lifecycle events through a test hook. `Platform.OS` is set to iOS so the real native navigation branches render. The native custody and transfer controllers are production implementations; SDK ports use a password accepted only by this synthetic runtime. No transaction can broadcast.

Run from `apps/mobile`:

```sh
node scripts/build-native-watch-ui.cjs
npx playwright test --config playwright.watch.config.ts
```

The browser suite checks authority transitions, pending-operation revocation, persistent public management, public-store failures, explicit watch-only affordances, address copy, and large-text layout. These are synthetic browser component checks; device Keychain, Android Keystore, SQLCipher, native capture protection and physical-device behavior require their separate native qualification procedures.

## Visual review mode

Use `/?visual-review=1&native-empty=1` for an absent native wallet. Open Wallet, then use the actual Create or Restore form. A public example password satisfying the real form policy is `Public-password1!`; Restore accepts only `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`. Creation also presents that public test phrase. Continue through the real backup flow: reveal with the chosen password, continue, then answer the three displayed word positions (`about` at position 12, otherwise `abandon`). The resulting Home uses the actual token controller and registry with an in-memory empty token store.

The optional biometric setup checkbox is available in this mode. Enroll during setup or through Security & backups → Biometric unlock, then lock to capture the real biometric-unlock button. `/?visual-review=1&device-unlock=1` starts with a synthetic existing wallet and device unlock already enabled; the example password above also unlocks it. `/?visual-review=1` starts with a synthetic existing wallet without enrollment.

Label these gallery frames **Simulated wallet and device authentication — no real keys or OS biometric prompt**. `window.__watchFixture.visual` supplies this label, the public example inputs and current synthetic state for capture tooling. These flags never enable transaction signing or broadcast. Without `visual-review=1`, all original fixture behavior is unchanged.
