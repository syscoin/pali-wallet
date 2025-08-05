export const getHost = (url: string): string => {
  if (typeof url === 'string' && url !== '') {
    return new URL(url).host;
  }

  return url;
};
