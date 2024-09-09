export function adjustUrl(url: string) {
  return url?.endsWith('/') ? url : `${url}/`;
}
