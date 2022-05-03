export type AssetPrice = {
  asset: string;
  price: number;
};

export interface IPriceState {
  coins: any;
  fiat: AssetPrice;
}
