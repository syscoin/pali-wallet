export interface IAssetPrice {
  asset: string;
  price: number;
  priceChange24h?: number;
}

export interface IPriceState {
  fiat: IAssetPrice;
}
