export const MAX_SPONSOR_URL_LENGTH = 128;

export const isValidSponsorServiceUrl = (value: string) => {
  const trimmedValue = value.trim();

  if (!trimmedValue || trimmedValue.length > MAX_SPONSOR_URL_LENGTH) {
    return false;
  }

  try {
    const url = new URL(trimmedValue);

    return (
      Boolean(url.hostname) &&
      (url.protocol === 'https:' || url.protocol === 'http:')
    );
  } catch {
    return false;
  }
};
