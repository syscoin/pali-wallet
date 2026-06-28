import { getAddress } from '@ethersproject/address';
import { hexConcat } from '@ethersproject/bytes';

import {
  buildSmartAccountUserOperation,
  encodeERC7579Executions,
  encodeSmartAccountValidatorNonceKey,
  PaliAuthConfig,
  SmartAccountPackedUserOperation,
} from './account';
import {
  getPaliSmartAccountFactory,
  getPaliSmartAccountFactoryAddress,
  paliSmartAccountInterface,
} from './contracts';
import type { Interface } from '@ethersproject/abi';
import type { Provider } from '@ethersproject/providers';

type PaliSmartAccountFactoryLike = {
  functions?: {
    'getInitData(address,bytes)'?: (
      validator: string,
      initData: string
    ) => Promise<[string]>;
  };
  getAddress: (salt: string, initCode: string) => Promise<string>;
  getInitData: (validator: string, initData: string) => Promise<string>;
  interface: Pick<Interface, 'encodeFunctionData'>;
};

export type PaliSmartAccountCall = {
  data?: string;
  target?: string;
  to?: string;
  value?: string;
};

export type ToPaliSmartAccountParams = {
  address?: string;
  auth?: PaliAuthConfig;
  chainId: number;
  deploySalt: string;
  factory?: PaliSmartAccountFactoryLike;
  factoryAddress?: string;
  provider?: Provider;
};

export type PaliSmartAccountFactoryArgs = {
  factory: string;
  factoryData: string;
};

export type PaliSmartAccount = {
  address: string;
  auth?: PaliAuthConfig;
  chainId: number;
  deploySalt: string;
  encodeCalls: (calls: PaliSmartAccountCall[]) => string;
  encodeExecutions: (
    calls: PaliSmartAccountCall[]
  ) => ReturnType<typeof encodeERC7579Executions>;
  getDeploymentInitCode: () => Promise<string>;
  getFactoryArgs: () => Promise<PaliSmartAccountFactoryArgs>;
  getNonceKey: (subkey?: number) => string;
  prepareUserOperation: (params: {
    accountGasLimits?: SmartAccountPackedUserOperation['accountGasLimits'];
    calls: PaliSmartAccountCall[];
    gasFees?: SmartAccountPackedUserOperation['gasFees'];
    initCode?: string;
    nonce: string;
    paymasterAndData?: SmartAccountPackedUserOperation['paymasterAndData'];
    preVerificationGas?: SmartAccountPackedUserOperation['preVerificationGas'];
    signature?: SmartAccountPackedUserOperation['signature'];
  }) => SmartAccountPackedUserOperation;
};

const normalizeCalls = (calls: PaliSmartAccountCall[]) =>
  calls.map((call) => ({
    data: call.data || '0x',
    target: getAddress(call.target || call.to || ''),
    value: call.value || '0x0',
  }));

const requireAuth = (auth?: PaliAuthConfig): PaliAuthConfig => {
  if (!auth) {
    throw new Error('Smart account deployment requires authenticator metadata');
  }
  return auth;
};

const getValidatorInitData = async (
  factory: PaliSmartAccountFactoryLike,
  auth: PaliAuthConfig
) => {
  const overloadedGetInitData =
    factory.functions?.['getInitData(address,bytes)'];
  if (overloadedGetInitData) {
    const [initData] = await overloadedGetInitData(auth.validator, auth.data);
    return initData;
  }

  return factory.getInitData(auth.validator, auth.data);
};

export const toPaliSmartAccount = async ({
  address,
  auth,
  chainId,
  deploySalt,
  factory,
  factoryAddress = getPaliSmartAccountFactoryAddress(chainId),
  provider,
}: ToPaliSmartAccountParams): Promise<PaliSmartAccount> => {
  const accountFactory: PaliSmartAccountFactoryLike = (factory ||
    (() => {
      if (!provider) {
        throw new Error('Smart account factory requires a provider');
      }
      return getPaliSmartAccountFactory(chainId, provider, factoryAddress);
    })()) as PaliSmartAccountFactoryLike;

  const getFactoryArgs = async (): Promise<PaliSmartAccountFactoryArgs> => {
    const deploymentAuth = requireAuth(auth);
    const initCode = await getValidatorInitData(accountFactory, deploymentAuth);
    const factoryData = accountFactory.interface.encodeFunctionData(
      'createAccount',
      [deploySalt, initCode]
    );

    return {
      factory: getAddress(factoryAddress),
      factoryData,
    };
  };

  const resolvedAddress =
    address ||
    (await (async () => {
      const deploymentAuth = requireAuth(auth);
      const initCode = await getValidatorInitData(
        accountFactory,
        deploymentAuth
      );
      return getAddress(await accountFactory.getAddress(deploySalt, initCode));
    })());

  const encodeExecutions = (calls: PaliSmartAccountCall[]) =>
    encodeERC7579Executions(normalizeCalls(calls));

  const encodeCalls = (calls: PaliSmartAccountCall[]) => {
    const prepared = encodeExecutions(calls);
    return paliSmartAccountInterface.encodeFunctionData('execute', [
      prepared.mode,
      prepared.executionCalldata,
    ]);
  };

  return {
    address: getAddress(resolvedAddress),
    auth,
    chainId,
    deploySalt,
    encodeCalls,
    encodeExecutions,
    getDeploymentInitCode: async () => {
      const { factory: deploymentFactory, factoryData } =
        await getFactoryArgs();
      return hexConcat([deploymentFactory, factoryData]);
    },
    getFactoryArgs,
    getNonceKey: (subkey = 0) => {
      const activeAuth = requireAuth(auth);
      return encodeSmartAccountValidatorNonceKey(activeAuth.validator, subkey);
    },
    prepareUserOperation: ({
      accountGasLimits,
      calls,
      gasFees,
      initCode = '0x',
      nonce,
      paymasterAndData,
      preVerificationGas,
      signature,
    }) =>
      buildSmartAccountUserOperation({
        accountGasLimits,
        callData: encodeCalls(calls),
        gasFees,
        initCode,
        nonce,
        paymasterAndData,
        preVerificationGas,
        sender: getAddress(resolvedAddress),
        signature,
      }),
  };
};
