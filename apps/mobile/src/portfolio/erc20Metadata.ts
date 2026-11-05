import { getAddress } from 'ethers/address';
import { createErc20Policy } from '../../../../source/shared/erc20.ts';

// Resolve checksum code from the mobile installation, with shared value policy.
const policy = createErc20Policy(getAddress);
export const normalizeErc20Address = policy.normalizeNonzeroHexAddress;
export const parseErc20Metadata = policy.parseMetadata;
