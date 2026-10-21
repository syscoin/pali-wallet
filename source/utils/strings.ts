export function adjustUrl(url: string) {
  return url?.endsWith('/') ? url : `${url}/`;
}

export function buildExplorerUrl(
  explorer: string,
  resource: string,
  identifier: string
) {
  const url = new URL(explorer);
  const route = url.hash.startsWith('#/')
    ? new URL(url.hash.slice(1), url)
    : url;
  route.pathname = `${route.pathname.replace(
    /\/?$/,
    '/'
  )}${resource}/${encodeURIComponent(identifier)}`;
  if (route !== url) url.hash = route.pathname + route.search + route.hash;
  return url.href;
}
