export interface IFiatState {
  [assetId: string]: number;
  current: any | "usd";
}

export default interface IPriceState {
  fiat: IFiatState;
}
