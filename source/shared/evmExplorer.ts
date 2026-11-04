/** Pure Etherscan-compatible URL construction shared by native and extension hosts. */
export function buildAccountHistoryUrl(apiUrl: string, address: string, action: string, page?: number, offset = 30): URL {
  const url = new URL(apiUrl);
  const apiKey = url.searchParams.get('apikey') || url.searchParams.get('apiKey');
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', action);
  url.searchParams.set('address', address);
  if (action !== 'pendingtxlist') url.searchParams.set('sort', 'desc');
  if (page !== undefined) {
    url.searchParams.set('page', String(page));
    url.searchParams.set('offset', String(offset));
  }
  if (apiKey) url.searchParams.set('apikey', apiKey);
  return url;
}
