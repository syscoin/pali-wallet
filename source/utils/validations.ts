// Frontend-safe validation utilities
// These are lightweight implementations that don't pull in sysweb3 dependencies

import { ethers } from 'ethers';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

/**
 * Validates Ethereum address format
 */
export const isValidEthereumAddress = (address: string): boolean => {
  try {
    // Use ethers.js which is already in the bundle
    return ethers.utils.isAddress(address);
  } catch {
    return false;
  }
};

/**
 * Full Syscoin address validation using background service
 * This properly validates based on the network/coin type
 */
export const isValidSYSAddress = async (
  address: string,
  chainId: number
): Promise<boolean> => {
  try {
    // Use controllerEmitter to call MainController method
    const isValid = await controllerEmitter(
      ['wallet', 'validateSysAddress'],
      [address, chainId]
    );

    return Boolean(isValid);
  } catch (error) {
    console.error('Failed to validate SYS address:', error);
    // Fallback to basic validation if controller call fails
    return false;
  }
};

/**
 * Get ERC20 ABI from backend service
 * Returns the full JSON ABI format needed for InputDataDecoder
 */
export const getErc20Abi = async (): Promise<any[]> => {
  try {
    // Use controllerEmitter to get the proper JSON ABI from backend
    const abi = await controllerEmitter(['wallet', 'getErc20Abi'], []);

    return Array.isArray(abi) ? abi : [];
  } catch (error) {
    console.error('Failed to get ERC20 ABI:', error);
    // Return empty array if controller call fails
    return [];
  }
};

/**
 * Get ERC721 ABI from backend service
 */
export const getErc721Abi = async (): Promise<any[]> => {
  try {
    const abi = await controllerEmitter(['wallet', 'getErc721Abi'], []);
    return Array.isArray(abi) ? abi : [];
  } catch (error) {
    console.error('Failed to get ERC721 ABI:', error);
    return [];
  }
};

/**
 * Get ERC1155 ABI from backend service
 */
export const getErc1155Abi = async (): Promise<any[]> => {
  try {
    const abi = await controllerEmitter(['wallet', 'getErc1155Abi'], []);
    return Array.isArray(abi) ? abi : [];
  } catch (error) {
    console.error('Failed to get ERC1155 ABI:', error);
    return [];
  }
};

export const getContractType = async (
  contractAddress: string,
  web3Provider: any
): Promise<ISupportsInterfaceProps | undefined> => {
  try {
    const erc721Abi = await getErc721Abi();
    const contractERC721 = new ethers.Contract(
      contractAddress,
      erc721Abi,
      web3Provider
    );

    const supportsInterface = await contractERC721.supportsInterface(
      '0x80ac58cd'
    ); // ERC721

    if (supportsInterface) {
      return { type: 'ERC-721' };
    }
    throw new Error('ERC-721');
  } catch (e) {
    try {
      const erc1155Abi = await getErc1155Abi();
      const contractERC1155 = new ethers.Contract(
        contractAddress,
        erc1155Abi,
        web3Provider
      );
      const supportsInterface = await contractERC1155.supportsInterface(
        '0xd9b67a26'
      ); // ERC1155
      if (supportsInterface) {
        return { type: 'ERC-1155' };
      }
      throw new Error('ERC-1155');
    } catch (e1) {
      try {
        const erc20Abi = await getErc20Abi();
        const contractERC20 = new ethers.Contract(
          contractAddress,
          erc20Abi,
          web3Provider
        );
        const balanceOf = await contractERC20.balanceOf(contractAddress);

        if (typeof balanceOf === 'object') {
          return { type: 'ERC-20' };
        }
        throw new Error('ERC-20');
      } catch (e2) {
        return { type: 'Unknown', message: 'Standard not recognized' };
      }
    }
  }
};

export interface ISupportsInterfaceProps {
  message?: string;
  type: string;
}
