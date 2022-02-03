import { isNFT, countDecimals, sortList } from './utils';

describe('controllers utils', () => {
  it('should check if given token is a nft', () => {
    console.log(isNFT(2512785514));
    console.log(isNFT(831140473));
    console.log(isNFT(1214075697));
    expect(isNFT(2512785514)).toEqual(true);
    expect(isNFT(831140473)).toEqual(false);
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
