// NFT fallback image as a data URL
export const NFT_FALLBACK_IMAGE =
  'data:image/svg+xml;base64,' +
  btoa(`
<svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" rx="10" fill="#1E1E1E" />
  <rect x="20" y="20" width="60" height="60" rx="8" fill="#2D2D2D" stroke="#3D3D3D" stroke-width="2" />
  <path d="M35 65L45 45L55 55L65 35" stroke="#4D76B8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="65" cy="35" r="5" fill="#CB2C70" />
  <text x="50" y="85" text-anchor="middle" fill="#666666" font-size="10" font-weight="500" font-family="system-ui, -apple-system, sans-serif">NFT</text>
</svg>
`);
