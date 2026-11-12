<p align="center">
  <img src="apps/mobile/assets/app-icon.png" alt="Pali Wallet" width="96" height="96" />
</p>

# Pali Wallet

A self-custody wallet for Bitcoin, Syscoin and supported EVM and UTXO networks. Pali brings accounts, assets, dApps and hardware wallets together in a Chrome extension and native iOS and Android apps, with a shared wallet and transaction core.

[Website](https://paliwallet.com) · [Product tour](https://www.paliwallet.com/media/pali-product-tour.mp4) · [Documentation](https://docs.paliwallet.com) · [Chrome Web Store](https://chromewebstore.google.com/detail/pali-wallet/mgffkfbidihjpoaomajlbgchddlicgpn) · [App Store](https://apps.apple.com/app/id6834040718) · [Google Play](https://play.google.com/store/apps/details?id=com.paliwallet.mobile) · [GitHub releases](https://github.com/syscoin/pali-wallet/releases)

**v5 is in development.** This README describes the current source, which may differ from the published store release. Mobile store listings and build artifacts do not establish release readiness. Native-device, hardware-model and funded-network qualification are tracked separately in the [mobile implementation and qualification guide](apps/mobile/README.md).

## What’s in Pali

- **Accounts you control:** create or restore a wallet, import supported keys, connect a hardware wallet, or watch an account without importing its secrets.
- **Assets and activity:** native coins, ERC-20 tokens, ERC-721/ERC-1155 collectibles and Syscoin assets, with network-aware balances, transaction details and explorer links. The EVM portfolio can span the selected account’s added networks.
- **Transfers and recovery:** exact amounts, fee review, advanced nonce selection, eligible Speed Up/Cancel actions and retained signed transactions for reviewed retry after an interrupted submission.
- **Connected apps:** the extension’s injected provider and mobile WalletConnect, with origin/account/network permissions and explicit transaction and signature reviews.
- **Hardware and smart accounts:** Ledger and Trezor integrations, supported validator combinations, passkeys and guardian recovery. Availability depends on the device, transport, account policy and network.
- **Private notes and Sentry:** note backup/restore and supported privacy-pool operations, plus Sentry keys and linked-node controls on configured networks.

Both apps reuse shared account, amount, transaction, recovery and network-validation logic. Platform adapters handle browser permissions, native storage, device authentication and hardware transport.

## Networks

Use the network picker for built-in networks or add a supported custom registration. EVM and UTXO accounts retain their respective network and signing rules; network-specific services are available only where configured.

The v5 catalogue includes **zkSYS mainnet (5757)** by default and **Gateway mainnet (57570)** as an optional network. Their inclusion prepares the wallet for those networks; it does not announce that their RPCs or services are live. A failed network refresh does not turn another network’s balance into zero or prevent its successful refresh.

## Getting started

Use the Node version pinned in [`.nvmrc`](.nvmrc) and **Yarn 1.22.22**. The extension uses the root Yarn lockfile; mobile has its own npm lockfile. Install each dependency graph without regenerating its lockfile.

### Chrome extension

```sh
yarn install --frozen-lockfile
yarn dev:chrome
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `build/chrome/`. Keep the command running to rebuild after edits. Use a separate browser profile and disposable wallets for development.

### Mobile

Install the root dependencies above first, then:

```sh
cd apps/mobile
npm ci
npm run ios
# or: npm run android
```

Native builds require the matching Xcode or Android toolchain and signing setup. The build wrapper prepares pinned native/proving assets and reserves a build number; it requires write access to the repository’s build-counter branch. See the [mobile setup and build guide](apps/mobile/README.md#run) for details.

`npm run web` opens the design-validation surface. It is useful for layout review; native custody and OS authentication must be tested in the native app.

## Repository map

| Path                                  | Purpose                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| [`source/`](source/)                  | Chrome extension UI, background controllers and provider integration  |
| [`source/shared/`](source/shared/)    | Platform-independent logic used by extension and mobile               |
| [`apps/mobile/`](apps/mobile/)        | React Native app, native modules, platform adapters and qualification |
| [`e2e/`](e2e/) and [`tests/`](tests/) | Extension browser, integration and unit checks                        |
| [`docs/`](docs/)                      | User/developer documentation and implementation notes                 |

The shared SDK lives in [Sysweb3](https://github.com/sidhujag/sysweb3), with UTXO transaction support from [SyscoinJS](https://github.com/syscoin/syscoinjs-lib) and [syscointx-js](https://github.com/syscoin/syscointx-js). Dependency versions are pinned in the package manifests and lockfiles.

## Development and release checks

Run the checks relevant to your change:

```sh
# From the repository root
yarn type-check
yarn lint
yarn test:unit

# Mobile checks
cd apps/mobile
npm run typecheck
npm run lint
npm test
```

Browser flows, visual checks and native qualification have their own runners. Follow the applicable CI workflows and the [native qualification guide](apps/mobile/qualification/README.md); unit tests alone do not qualify a wallet release.

The extension and mobile marketing version stays at **5.0.0** during v5 development. Mobile builds increment iOS/Android build numbers; extension Canary builds use **5.0.0.N**. Production and Canary are separate distribution channels. The [build and release guide](docs/build-and-release.md) covers artifacts, receipts, counters and store submission.

## Security and support

Mobile sensitive software operations require OS-enforced authorization; normal public wallet browsing does not decrypt the signing root. Extension vault access uses a password, with optional local passkey unlock. Software signing occurs in the authorized app process; it does not turn a phone into a hardware wallet.

Read the [privacy and safety guide](https://docs.paliwallet.com/docs/users/privacy-and-safety) and [mobile security requirements](apps/mobile/SECURITY.md). Never include a recovery phrase, private key, private note or password in an issue or support message. For security concerns, contact [pali@syscoin.org](mailto:pali@syscoin.org) privately.

Pali Wallet is available under the [MIT license](LICENSE). The browser extension originally used [web-extension-starter](https://github.com/abhijithvijayan/web-extension-starter).
