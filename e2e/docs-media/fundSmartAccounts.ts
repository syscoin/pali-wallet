import { getAddress } from '@ethersproject/address';
import { Contract } from '@ethersproject/contracts';
import { JsonRpcProvider } from '@ethersproject/providers';
import { formatEther, parseEther } from '@ethersproject/units';
import { Wallet } from '@ethersproject/wallet';

import {
  encodeEcdsaValidatorInitData,
  getPaliSmartAccountDeploymentSalt,
} from '../../source/utils/smartAccount/account';
import {
  getPaliModuleAddress,
  getPaliSmartAccountFactoryAddress,
  PALI_ERC7579_FACTORY_ABI,
} from '../../source/utils/smartAccount/contracts';
import { E2E_CONFIG } from '../harness/config';

export type PredictedSmartAccount = {
  accountIndex: number;
  address: string;
  balance: string;
  deployed: boolean;
};

// Smart accounts pay their own deployment + userOp gas (no paymaster), so a
// fresh deterministic index starts with a zero balance and the dapp
// onboarding flow dies with PALI_NATIVE_GAS_REQUIRED. Pali derives the
// address from (anchor = HD0, accountIndex, chainId, factory) exactly like
// SmartAccountController.deriveSmartAccountRecord, which lets us predict and
// pre-fund the indices a capture run will mint before any popup opens.
export const predictAndFundSmartAccounts = async ({
  indexCount,
  minBalance = parseEther('0.5'),
  topUp = parseEther('1'),
}: {
  indexCount: number;
  minBalance?: ReturnType<typeof parseEther>;
  topUp?: ReturnType<typeof parseEther>;
}): Promise<PredictedSmartAccount[]> => {
  const chainId = E2E_CONFIG.chainId;
  const provider = new JsonRpcProvider(E2E_CONFIG.rpcUrl, chainId);
  const funder = Wallet.fromMnemonic(E2E_CONFIG.seedPhrase).connect(provider);

  const factoryAddress = getPaliSmartAccountFactoryAddress(chainId);
  const factory = new Contract(
    factoryAddress,
    PALI_ERC7579_FACTORY_ABI,
    provider
  );
  // Mirrors SmartAccountController.getWalletRecoveryAnchor.
  const anchor = `pali:eip155:${chainId}:${getAddress(
    funder.address
  ).toLowerCase()}:smart-account-v1`;
  // Fresh accounts bootstrap with the ECDSA validator owned by HD0.
  const initData = encodeEcdsaValidatorInitData([funder.address], 1);
  const validator = getPaliModuleAddress(chainId, 'ecdsa');
  const initCode = await factory['getInitData(address,bytes)'](
    validator,
    initData
  );

  const results: PredictedSmartAccount[] = [];
  let nonce = await provider.getTransactionCount(funder.address);
  for (let accountIndex = 0; accountIndex < indexCount; accountIndex += 1) {
    const salt = getPaliSmartAccountDeploymentSalt({
      accountIndex,
      anchor,
      chainId,
      factoryAddress,
    });
    const address = getAddress(
      await factory['getAddress(bytes32,bytes)'](salt, initCode)
    );
    const [balance, code] = await Promise.all([
      provider.getBalance(address),
      provider.getCode(address),
    ]);
    results.push({
      accountIndex,
      address,
      balance: formatEther(balance),
      deployed: code !== '0x',
    });
    // Deployed indices are burned -- the index walk never mints them again,
    // so topping them up would strand funds. Only fresh (undeployed)
    // addresses need the deploy-gas reserve. Pali's prefund gate requires
    // gasUnitsReserve (~2M units for a composite deploy) * maxFeePerGas, so
    // at testnet spikes of ~100+ gwei the address needs ~0.5+ TSYS.
    if (code === '0x' && balance.lt(minBalance)) {
      // This testnet RPC's eth_estimateGas returns an absurd (~48M) limit for
      // plain value transfers, which makes the auto-estimated maxFee exceed
      // the balance and aborts the send. Pin a sane limit so the funding tx
      // never depends on that broken estimate (100k covers a receive hook on
      // an already-deployed smart-account address).
      const tx = await funder.sendTransaction({
        gasLimit: 100_000,
        nonce,
        to: address,
        value: topUp,
      });
      nonce += 1;
      await tx.wait();
      results[results.length - 1].balance = formatEther(
        await provider.getBalance(address)
      );
    }
  }
  return results;
};
