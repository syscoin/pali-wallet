import { getAddress, getCreate2Address } from 'ethers/address';

import {
  defaultAbiCoder,
  hexConcat,
  Interface,
  keccak256,
  ZeroAddress,
} from '../ethersV6Compat.ts';

import { paliSmartAccountFactoryInterface } from './contracts.ts';
import {
  PALI_ACCOUNT_PROXY_CREATION_CODE,
  PALI_CANONICAL_FACTORY_ADDRESS,
  PALI_INFRASTRUCTURE_METADATA_BY_ID,
} from './deploymentMetadata.ts';

const moduleTuple = 'tuple(address module,bytes data)';
const initializer = new Interface([
  'function initializeAccount(bytes initCode)',
]);

/** Derive deployment bytes and address from the canonical factory artifact and local owner data. */
export function derivePaliSmartAccountDeployment({
  validator,
  data,
  deploySalt,
  factoryAddress,
}: {
  data: string;
  deploySalt: string;
  factoryAddress: string;
  validator: string;
}) {
  const factory = getAddress(factoryAddress);
  if (factory !== getAddress(PALI_CANONICAL_FACTORY_ADDRESS))
    throw new Error('Smart account factory has no trusted deployment artifact');

  const initCode = defaultAbiCoder.encode(
    [`${moduleTuple}[]`, `${moduleTuple}[]`, moduleTuple, `${moduleTuple}[]`],
    [[[getAddress(validator), data]], [], [ZeroAddress, '0x'], []]
  ) as string;
  const proxy = hexConcat([
    PALI_ACCOUNT_PROXY_CREATION_CODE,
    defaultAbiCoder.encode(
      ['address', 'bytes'],
      [
        PALI_INFRASTRUCTURE_METADATA_BY_ID.accountImplementation.address,
        initializer.encodeFunctionData('initializeAccount', [initCode]),
      ]
    ),
  ]);
  return {
    address: getCreate2Address(factory, deploySalt, keccak256(proxy)),
    factory,
    factoryData: paliSmartAccountFactoryInterface.encodeFunctionData(
      'createAccount',
      [deploySalt, initCode]
    ) as string,
    initCode,
  };
}
