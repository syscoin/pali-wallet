# Native custody UI browser fixture

This isolated Expo project renders the actual `NativeSend`, `NativeAccounts` and `NativeNetworks` components with public
external-store test doubles. It never opens wallet storage, signs a transaction or
contacts an RPC endpoint. Its test controls and sample passwords are not imported
by the production app.

`npm run test:ui` builds this entry into ignored `dist-native-send-ui`, serves it
on loopback port 4179, and runs the Playwright regressions alongside the normal
preview suite. The production package entry remains unchanged.
