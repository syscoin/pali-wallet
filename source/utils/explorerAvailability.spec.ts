import { hasExplorer, selectExplorerNetwork } from './strings';
import { networkRegistrationFingerprint } from './networkRegistration';

it('distinguishes a blank new EVM explorer from a legacy or explicitly identical URL', () => {
  const network: any = {
    kind: 'ethereum',
    url: 'https://rpc.invalid/',
    explorer: 'https://rpc.invalid/',
    chainId: 1,
  };
  const absent = { ...network, explorerExplicitlyAbsent: true };
  expect(hasExplorer(absent)).toBe(false);
  expect(hasExplorer(network)).toBe(true);
  expect(networkRegistrationFingerprint(absent)).not.toBe(
    networkRegistrationFingerprint(network)
  );
  expect(hasExplorer({ ...absent, kind: 'syscoin' })).toBe(true);
});

it('uses saved explorer metadata only for the same active EVM chain and RPC', () => {
  const active = {
    kind: 'ethereum',
    chainId: 987,
    slip44: 60,
    url: 'https://rpc.invalid/',
    apiUrl: '',
    explorer: 'https://rpc.invalid/',
    explorerExplicitlyAbsent: true,
  };
  const saved = {
    ...active,
    explorer: 'https://explorer.invalid/',
    explorerExplicitlyAbsent: false,
  };
  const state: any = {
    vault: { activeNetwork: active },
    vaultGlobal: { activeSlip44: 60, networks: { ethereum: { 987: saved } } },
  };
  expect(selectExplorerNetwork(state)).toBe(saved);
  expect(state.vault.activeNetwork).toBe(active);
  const apiEdited = { ...saved, apiUrl: 'https://other-api.invalid/' };
  state.vaultGlobal.networks.ethereum[987] = apiEdited;
  expect(selectExplorerNetwork(state)).toBe(apiEdited);
  expect(state.vault.activeNetwork.apiUrl).toBe('');
  for (const changed of [
    { kind: 'syscoin' },
    { chainId: 988 },
    { slip44: 61 },
    { url: 'https://other-rpc.invalid/' },
  ]) {
    state.vaultGlobal.networks.ethereum[987] = { ...saved, ...changed };
    expect(selectExplorerNetwork(state)).toBe(active);
  }
  state.vaultGlobal.networks.ethereum[987] = saved;
  state.vaultGlobal.activeSlip44 = 57;
  expect(selectExplorerNetwork(state)).toBe(active);
});
