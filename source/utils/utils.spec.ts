import { getHost } from './getHost';
import { isNFT } from './isNft';

describe('Utils', () => {
  //* getHost
  it('should get the host from an url', () => {
    const host = getHost('https://test-url.com');
    expect(host).toBe('test-url.com');
  });

  //* isNFT
  it('should check if a given guid is NFT', () => {
    expect(isNFT(5271816415)).toBe(true);
    expect(isNFT(70131121)).toBe(false);
  });
});
