# Pali Wallet Browser extension

Started with
[web-extension-starter](https://github.com/abhijithvijayan/web-extension-starter)

To learn how to develop Pali Wallet-compatible applications, visit our [documentation](https://docs.paliwallet.com/).

## Getting Started

Ensure you have

- [Node.js](https://nodejs.org) 26.12.1 (security-patched release; see `.nvmrc`) installed
- [Yarn](https://yarnpkg.com) 1.22.22 installed

Then run the following:

- `yarn install` to install dependencies.
- `yarn run dev:chrome` to start the development server for chrome extension
- `yarn run dev:firefox` to start the development server for firefox addon
- `yarn run dev:opera` to start the development server for opera extension
- `yarn run build:chrome` to build chrome extension
- `yarn run build:firefox` to build firefox addon
- `yarn run build:opera` to build opera extension
- `yarn run build` builds and packs extensions all at once to build/ directory

### Development

- `yarn install` to install dependencies.
- To watch file changes in development

  - Chrome
    - `yarn run dev:chrome`
  - Firefox
    - `yarn run dev:firefox`
  - Opera
    - `yarn run dev:opera`

- **Load extension in browser**

- ### Chrome

  - Go to the browser address bar and type `chrome://extensions`
  - Check the `Developer Mode` button to enable it.
  - Click on the `Load Unpacked Extension…` button.
  - Select your extension’s extracted directory.

- ### Firefox

  - Load the Add-on via `about:debugging` as temporary Add-on.
  - Choose the `manifest.json` file in the extracted directory

- ### Opera

  - Load the extension via `opera:extensions`
  - Check the `Developer Mode` and load as unpacked from extension’s extracted directory.

### Production and releases

- `yarn run build:chrome` builds the production Chrome extension in `build/chrome/` and creates a versioned ZIP in `build/`.
- `yarn run build:canary` builds the diagnostic Canary variant. Use the production Chrome ZIP for a regular release.
- `yarn run build` also runs the Firefox and Opera build scripts. These targets require their own browser validation; a successful build does not establish release readiness.

Keep the release version synchronized in `package.json`, the root `manifest.json`, and the Manifest V3 configuration in `source/config/consts.js`. The Chrome manifest-generation step uses the package version when regenerating `manifest.json`, which is copied into the build.

The [release workflow](.github/workflows/release.yml) runs on pushes to `master`, `develop`, and `pre-release`. It skips release builds when the package version is unchanged. A version change builds the Chrome production and Canary ZIPs, checks that exactly one of each exists and that the release tag is new, then creates a **draft prerelease** tied to the triggering commit. Review the artifacts and required checks before publishing. Creating a GitHub draft does not submit or publish the extension to the Chrome Web Store.

See the [documentation index](docs/README.md) for user guides, API documentation, and implementation notes.
