import { isNFT, countDecimals, sortList } from './utils';

describe('controllers utils', () => {
  it('should check if given token is a nft', () => {
    expect(isNFT(5271816415)).toEqual(true);
    expect(isNFT(70131121)).toEqual(false);
  });

  it('should check amount decimals to be less than or equal permitted decimals', () => {
    const permittedDecimals = 8;
    const valueDecimals = countDecimals(10.12345678);

    expect(valueDecimals).toBeLessThanOrEqual(permittedDecimals);
  });

  it('should sort an alfabetic given list', () => {
    const listToBeSorted = [
      {
        symbol: 'tsdb',
      },
      {
        symbol: 'abcd',
      },
      {
        symbol: 'dcdd',
      },
    ];

    const sortedList = sortList(listToBeSorted);

    expect(sortedList).toEqual([
      {
        symbol: 'abcd',
      },
      {
        symbol: 'dcdd',
      },
      {
        symbol: 'tsdb',
      },
    ]);
  });
});
