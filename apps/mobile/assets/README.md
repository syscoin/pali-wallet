# Mobile brand assets

`../../../source/assets/all_assets/syscoin.png` is the shared, unmodified Syscoin image used by native and extension. Both native SYS networks use this mark; network identity is conveyed by the network label. Never apply it to an arbitrary token based only on its symbol.

Source: https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/syscoin/info/logo.png

SHA-256: `14b4e6b95e387c6d15ef78122b1873a00c1982c0fc4dcad78a8e9b739be41ac8`

Packaged locally to avoid remote image requests at render time. Matches the existing Pali artwork asset byte for byte.

## Installed app icons

`app-icon.svg` reuses the two Pali paths from `docs/portal/static/img/logo.svg`, with the pink/blue brand colors and the wallet's navy background. Its PNG is a 1024 × 1024 opaque RGB square; iOS supplies the corner mask.

Android uses the separate transparent 1024 × 1024 `adaptive-icon.png` over the same navy background. The mark stays inside the adaptive icon's central safe zone. `monochrome-icon.png` supplies the matching white mask for themed icons, and `notification-icon.png` is a white-on-transparent 96 × 96 notification mask.

The SVG files are the resolution-independent sources. PNGs were rasterized directly from those paths, without enlarging the extension's 128px favicon. Icon updates take effect through native packaging; a JavaScript-only update cannot replace an installed launcher icon.
