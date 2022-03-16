export interface IFiatState {
  [assetId: string]: number;
}

export default interface IPriceState {
  fiat: IFiatState;
}
