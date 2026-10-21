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
