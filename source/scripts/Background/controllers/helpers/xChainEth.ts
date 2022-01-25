import { ExplorerUrl, InfuraCreds, Client } from '@xchainjs/xchain-ethereum';
// import { Network } from '@xchainjs/xchain-client';
import { BigNumber, ethers, FixedNumber } from 'ethers';
import ERC_20_ABI from 'erc-20-abi';
import * as utils from '@xchainjs/xchain-util';

import { tokenContractService } from './token-contract-service';

export { utils };

type XClientEthParams = {
  etherscanApiKey?: string;
  explorerUrl?: ExplorerUrl;
  infuraCreds?: InfuraCreds;
  network?: any;
  privateKey?: string;
};

const { InfuraProvider } = ethers.providers;

export class XChainEthClient extends Client {
  private infuraProjectId: string;

  constructor({
    network,
    explorerUrl,
    privateKey,
    etherscanApiKey,
    infuraCreds,
  }: XClientEthParams) {
    super({ network, explorerUrl, etherscanApiKey, infuraCreds });

    if (infuraCreds?.projectId) {
      this.infuraProjectId = infuraCreds.projectId;
    }

    // @ts-ignore
    this['changeWallet'](new ethers.Wallet(privateKey, this.getProvider()));
  }

  async estimateTokenTransferGasLimit(
    recipient: string,
    contractAddress: string,
    txAmount: BigNumber,
    defaultValue?: number
  ) {
    try {
      const contract = new ethers.Contract(
        contractAddress,
        ERC_20_ABI,
        this.getProvider()
      );
      const gasLimit: BigNumber = await contract.estimateGas.transfer(
        recipient,
        txAmount,
        { from: this.getAddress() }
      );

      return gasLimit.toNumber();
    } catch (error) {
      return defaultValue;
    }
  }

  isValidEthereumAddress(address: string) {
    return ethers.utils.isAddress(address);
  }

  getTransactionCount(address: string, chainId = 1) {
    const infuraProvider = new InfuraProvider(chainId, this.infuraProjectId);

    return infuraProvider.getTransactionCount(address, 'pending');
  }

  async getTokenBalance(ethAddress: string, token: TokenInfo, chainId = 1) {
    const infuraProvider = new InfuraProvider(chainId, this.infuraProjectId);
    const tokenBalances = await tokenContractService.getTokenBalance(
      infuraProvider,
      ethAddress,
      token.address,
      chainId
    );

    return FixedNumber.fromValue(
      BigNumber.from(tokenBalances[token.address]),
      token.decimals
    ).toUnsafeFloat();
  }

  async waitForTransaction(hash: string, chainId = 1) {
    const infuraProvider = new InfuraProvider(chainId, this.infuraProjectId);

    return infuraProvider.waitForTransaction(hash);
  }

  async getTokenInfo(address: string, chainId = 1) {
    if (this.isValidEthereumAddress(address)) {
      const infuraProvider = new InfuraProvider(chainId, this.infuraProjectId);
      try {
        const result = await tokenContractService.getTokenInfo(
          infuraProvider,
          address
        );

        return result;
      } catch (error) {
        return null;
      }
    }

    return null;
  }

  async isContractAddress(address: string, chainId = 1) {
    if (this.isValidEthereumAddress(address)) {
      const provider = new InfuraProvider(chainId, this.infuraProjectId);
      const code = await provider.getCode(address);

      return code !== '0x';
    }

    return false;
  }
}

type TokenInfo = {
  address: string;
  balance?: string;
  decimals: number;
  logoURI?: string;
  name?: string;
  symbol?: string;
};
