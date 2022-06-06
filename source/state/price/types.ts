export interface IAssetPrice {
  asset: string;
  price: number;
}

export interface IPriceState {
  coins: any;
  fiat: IAssetPrice;
}
