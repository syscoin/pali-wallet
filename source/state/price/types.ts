export interface IAssetPrice {
  /** Whether a finite quote was received; absent on legacy snapshots. */
  available?: boolean;
  asset: string;
  price: number;
  priceChange24h?: number;
}

export interface IPriceState {
  fiat: IAssetPrice;
}
