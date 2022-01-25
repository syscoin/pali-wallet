import { AssetType } from 'state/vault/types';

export interface IAssetInfoState {
  address: string;
  decimals: number;
  id: string; // for native this is network name, for ERC-20 this is the contract (address)
  label: string;
  logo?: string;
  native?: true;
  // if `native` is "true", `network` should be "both"
  network?: 'both' | 'mainnet' | 'testnet';
  priceId?: string;
  symbol: string;
  type: AssetType;
  // contractAddress?: string;
}

export default interface IAssetListState {
  [id: string]: IAssetInfoState;
}
