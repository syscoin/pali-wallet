import type { RootState } from 'state/store';

// A registry edit may change explorer metadata without switching the live
// network. Use it only when the live chain and RPC identity still match.
export function selectExplorerNetwork(state: RootState) {
  const active = state.vault.activeNetwork;
  if (
    active.kind !== 'ethereum' ||
    state.vaultGlobal?.activeSlip44 !== active.slip44
  )
    return active;
  const saved = state.vaultGlobal?.networks?.ethereum?.[active.chainId];
  return saved &&
    saved.kind === active.kind &&
    saved.chainId === active.chainId &&
    saved.slip44 === active.slip44 &&
    saved.url === active.url
    ? saved
    : active;
}

export function hasExplorer(network: {
  kind?: string;
  explorerExplicitlyAbsent?: boolean;
}) {
  return (
    network.kind === 'syscoin' || network.explorerExplicitlyAbsent !== true
  );
}

export function selectExplorerUrl(state: RootState) {
  const network = selectExplorerNetwork(state);
  return hasExplorer(network) ? network.explorer || network.url : undefined;
}

export function adjustUrl(url: string) {
  return url?.endsWith('/') ? url : `${url}/`;
}

export function buildExplorerUrl(
  explorer: string,
  resource: string,
  identifier: string
) {
  const url = new URL(explorer);
  const prefix = url.hash.startsWith('#!/') ? '#!' : '#';
  const route = url.hash.startsWith(`${prefix}/`)
    ? new URL(url.hash.slice(prefix.length), url)
    : url;
  route.pathname = `${route.pathname.replace(
    /\/?$/,
    '/'
  )}${resource}/${encodeURIComponent(identifier)}`;
  if (route !== url)
    url.hash = prefix + route.pathname + route.search + route.hash;
  return url.href;
}
