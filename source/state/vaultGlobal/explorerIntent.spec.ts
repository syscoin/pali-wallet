import vaultGlobal, { setNetwork } from './index';
import vault, { setNetworkChange } from '../vault';
import { INetwork, INetworkType } from '../../types/network';

it('preserves explicit absence through registry serialization and switching, and clears it on edit', () => {
  const base: INetwork = {
    kind: INetworkType.Ethereum,
    chainId: 987654,
    currency: 'eth',
    label: 'Synthetic',
    url: 'https://rpc.invalid/',
    explorer: 'https://rpc.invalid/',
    slip44: 60,
  };
  const absent = { ...base, explorerExplicitlyAbsent: true };
  const registered = vaultGlobal(undefined, setNetwork({ network: absent }));
  const restored = JSON.parse(JSON.stringify(registered));
  const loaded = restored.networks.ethereum[base.chainId];
  expect(loaded.explorerExplicitlyAbsent).toBe(true);
  expect(
    vault(undefined, setNetworkChange({ activeNetwork: loaded })).activeNetwork
      .explorerExplicitlyAbsent
  ).toBe(true);
  const edited = vaultGlobal(
    restored,
    setNetwork({ network: base, isEdit: true })
  );
  expect(
    edited.networks.ethereum[base.chainId].explorerExplicitlyAbsent
  ).toBeUndefined();
  expect(edited.networks.ethereum[base.chainId].explorer).toBe(base.url);
});
