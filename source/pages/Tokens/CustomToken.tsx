import { Form, Input } from 'antd';
import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';

import {
  isValidEthereumAddress,
  getTokenStandardMetadata,
  contractChecker,
  ISupportsInterfaceProps,
} from '@pollum-io/sysweb3-utils';

import { Card, DefaultModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { IAddCustomTokenMetadataInfos, ITokenEthProps } from 'types/tokens';
import { getController } from 'utils/browser';

import { CustomTokenErrorModal } from './CustomTokenErrorModal';

interface ICustomTokenComponentProps {
  isEdit: boolean;
  tokenToEdit: ITokenEthProps | null;
}

const TOKENS_WARNING_INITIAL_VALUE = {
  error: false,
  value: '',
};

const TOKEN_CONTRACT_TYPE_INITIAL_VALUE = {
  contractType: '',
  error: false,
  errorType: '',
  message: '',
};

export const CustomToken = (props: ICustomTokenComponentProps) => {
  const controller = getController();

  const { isEdit, tokenToEdit } = props;

  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [added, setAdded] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [ercError, setErcError] = useState({
    errorType: '',
  });

  const [tokenContractType, setTokenContractType] = useState(
    TOKEN_CONTRACT_TYPE_INITIAL_VALUE
  );

  const [tokenMetadataInfos, setTokenMetadataInfos] =
    useState<IAddCustomTokenMetadataInfos | null>(null);
  const [tokenDecimalsWarning, setTokenDecimalsWarning] = useState(
    TOKENS_WARNING_INITIAL_VALUE
  );
  const [tokenSymbolWarning, setTokenSymbolWarning] = useState(
    TOKENS_WARNING_INITIAL_VALUE
  );

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  const web3Provider = controller.wallet.ethereumTransaction.web3Provider;

  const isTokenErc20 = tokenContractType.contractType === 'ERC-20';
  const isTokenErc721 = tokenContractType.contractType === 'ERC-721';

  const validatedContractsTypes = ['ERC-1155', 'Unknown'];

  const handleSubmit = async ({
    contractAddress,
    symbol,
    decimals,
  }: {
    contractAddress: string;
    decimals: number;
    symbol: string;
  }) => {
    setIsLoading(true);

    switch (isEdit) {
      case false:
        try {
          const addTokenMethodResponse =
            await controller.wallet.assets.evm.addCustomTokenByType(
              activeAccount.address,
              contractAddress,
              symbol,
              decimals,
              web3Provider
            );

          if (addTokenMethodResponse.error) {
            setIsLoading(false);
            setErcError({
              errorType: addTokenMethodResponse.errorType,
            });

            return;
          }

          const tokenToAddWithSubmitValues = {
            ...addTokenMethodResponse.tokenToAdd,
            decimals: Number(decimals),
            ...(addTokenMethodResponse.tokenToAdd.tokenSymbol.toUpperCase() !==
              symbol.toUpperCase() && { editedSymbolToUse: symbol }),
          };

          //Save token at state
          await controller.wallet.account.eth.saveTokenInfo(
            tokenToAddWithSubmitValues
          );

          setAdded(true);
        } catch (error) {
          if (String(error).includes('Token already exists')) {
            setErcError({
              errorType: 'TokenExists',
            });

            return;
          }

          setErcError({
            errorType: 'Undefined',
          });
        } finally {
          setIsLoading(false);
        }
        break;
      case true:
        try {
          //Edit token at state
          const editedToken = {
            ...tokenToEdit,
            tokenSymbol: symbol,
            decimals: Number(decimals),
          };

          controller.wallet.account.eth.editTokenInfo(editedToken);

          setAdded(true);
        } catch (error) {
          setErcError({
            errorType: 'Undefined',
          });
        } finally {
          setIsLoading(false);
        }
        break;
    }
  };

  const resetErcErrorState = () => {
    setErcError({
      errorType: '',
    });
  };

  const resetAddTokenErrorsAndValues = () => {
    form.setFieldsValue({
      symbol: '',
      decimals: '',
    });

    setTokenMetadataInfos({
      contractAddress: '',
      symbol: '',
      decimals: '',
    });

    if (tokenDecimalsWarning.error) {
      setTokenDecimalsWarning({
        error: false,
        value: '',
      });
    }

    if (tokenSymbolWarning.error) {
      setTokenSymbolWarning({
        error: false,
        value: '',
      });
    }
  };

  const getContractType = async (
    contractValue: string,
    isForEdit?: boolean
  ) => {
    const contractResponse = (await contractChecker(
      contractValue,
      web3Provider
    )) as ISupportsInterfaceProps;

    if (String(contractResponse).includes('Invalid contract address')) {
      setTokenContractType({
        contractType: 'Invalid',
        error: true,
        errorType: 'Invalid',
        message:
          'Invalid contract address. Verify the current contract address or the current network!',
      });
      return;
    }

    switch (contractResponse.type) {
      case 'ERC-721':
        setTokenContractType({
          contractType: 'ERC-721',
          error: false,
          errorType: '',
          message: '',
        });

        if (isForEdit) {
          setTokenMetadataInfos({
            contractAddress: contractValue,
            symbol: '',
            decimals: 0,
          });
        }

        break;

      case 'ERC-1155':
        setTokenContractType({
          contractType: 'ERC-1155',
          error: true,
          errorType: 'ERC-1155',
          message: contractResponse.message,
        });
        break;
      case 'Unknown':
        setTokenContractType({
          contractType: 'Unknown',
          error: true,
          errorType: 'Unknown',
          message: contractResponse.message,
        });
        break;

      //Default for ERC-20
      default:
        setTokenContractType({
          contractType: 'ERC-20',
          error: false,
          errorType: '',
          message: '',
        });

        if (isForEdit) {
          await getErc20TokenValues(contractValue, isForEdit);
        }

        break;
    }

    return contractResponse;
  };

  const getErc20TokenValues = async (
    tokenAddress: string,
    isForEdit?: boolean
  ) => {
    const { decimals, tokenSymbol } = await getTokenStandardMetadata(
      tokenAddress,
      activeAccount.address,
      web3Provider
    );

    if (decimals && tokenSymbol) {
      if (!isForEdit) {
        form.setFieldsValue({
          symbol: tokenSymbol,
          decimals: String(decimals),
        });
      }

      setTokenMetadataInfos({
        contractAddress: tokenAddress,
        symbol: tokenSymbol,
        decimals: decimals,
      });
    }
  };

  useEffect(() => {
    if (!isEdit) return;

    getContractType(tokenToEdit.contractAddress, isEdit);
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit || !tokenMetadataInfos || tokenContractType.error) return;

    const tokenDataValidationForErc20 =
      isTokenErc20 && tokenMetadataInfos.decimals && tokenMetadataInfos.symbol;

    //Validate when user enter to edit his token to show the original Token data
    if (
      Boolean(
        isEdit &&
          tokenDataValidationForErc20 &&
          tokenMetadataInfos.symbol.toUpperCase() !==
            tokenToEdit.tokenSymbol.toUpperCase()
      )
    ) {
      setTokenSymbolWarning({
        error: true,
        value: tokenToEdit.tokenSymbol,
      });
    }

    if (
      Boolean(
        isEdit &&
          Number(tokenMetadataInfos.decimals) !== Number(tokenToEdit.decimals)
      )
    ) {
      setTokenDecimalsWarning({
        error: true,
        value: String(tokenToEdit.decimals),
      });
    }
  }, [isEdit, tokenMetadataInfos, tokenContractType]);

  return (
    <>
      <Form
        validateMessages={{ default: '' }}
        form={form}
        id="token-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        onFinish={handleSubmit}
        initialValues={{
          contractAddress: isEdit ? tokenToEdit.contractAddress : '',
          symbol: isEdit ? tokenToEdit.tokenSymbol : '',
          decimals: isEdit ? tokenToEdit.decimals : '',
        }}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center mt-4 text-center md:w-full"
      >
        <Form.Item
          validateTrigger="onChange"
          name="contractAddress"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: 'Please, type token contract address!',
            },
            () => ({
              async validator(_, value) {
                const keepValue = Boolean(
                  tokenDecimalsWarning.error || tokenSymbolWarning.error
                );

                const normalValidation = Boolean(
                  value && value.length === 42 && isValidEthereumAddress(value)
                );

                const validationForEditToken = isEdit || keepValue;

                if (
                  (validationForEditToken && isTokenErc721) ||
                  validatedContractsTypes.some((contracts) =>
                    tokenContractType.contractType.includes(contracts)
                  )
                ) {
                  return Promise.resolve();
                }

                if (normalValidation) {
                  const requestContractType = await getContractType(value);

                  const isSameContractAndAddress =
                    requestContractType.type ===
                      tokenContractType.contractType &&
                    value === tokenMetadataInfos.contractAddress;

                  if (isSameContractAndAddress) {
                    return Promise.resolve();
                  }

                  if (requestContractType.type === 'ERC-20') {
                    await getErc20TokenValues(value);
                  }

                  if (requestContractType.type === 'ERC-721') {
                    form.setFieldsValue({
                      symbol: '',
                      decimals: '0',
                    });

                    setTokenMetadataInfos({
                      contractAddress: value,
                      symbol: '',
                      decimals: 0,
                    });
                  }

                  return Promise.resolve();
                } else {
                  resetAddTokenErrorsAndValues();

                  return Promise.reject();
                }
              },
            }),
          ]}
        >
          <Input
            readOnly={isEdit}
            type="text"
            disabled={isEdit}
            className="input-small relative"
            placeholder="Contract address"
          />
        </Form.Item>

        <Form.Item
          validateTrigger="onChange"
          name="symbol"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: 'Please, type token symbol!',
            },
            () => ({
              async validator(_, value) {
                if (!value) {
                  return Promise.reject();
                }

                const validationSymbolWarning = Boolean(
                  value &&
                    isTokenErc20 &&
                    tokenMetadataInfos.symbol &&
                    value.toUpperCase() !==
                      tokenMetadataInfos.symbol.toUpperCase()
                );

                if (validationSymbolWarning) {
                  setTokenSymbolWarning({
                    error: true,
                    value: value,
                  });
                } else {
                  setTokenSymbolWarning({
                    error: false,
                    value: '',
                  });
                }

                return Promise.resolve();
              },
            }),
          ]}
        >
          <Input
            type="text"
            className="input-small relative"
            placeholder="Token symbol"
          />
        </Form.Item>

        <Form.Item
          validateTrigger="onChange"
          name="decimals"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: 'Please, type token decimals!',
              pattern: new RegExp(/^[0-9]+$/),
            },
            () => ({
              validator(_, value) {
                if (!value) {
                  return Promise.reject();
                }

                if (
                  validatedContractsTypes.some((validation) =>
                    tokenContractType.contractType.includes(validation)
                  )
                ) {
                  return Promise.resolve();
                }

                const validationDecimalsWarning = Boolean(
                  value !== '' &&
                    tokenMetadataInfos.decimals !== '' &&
                    Number(value) !== Number(tokenMetadataInfos.decimals)
                );

                if (validationDecimalsWarning) {
                  setTokenDecimalsWarning({
                    error: true,
                    value: value,
                  });
                } else {
                  setTokenDecimalsWarning({
                    error: false,
                    value: '',
                  });
                }

                return Promise.resolve();
              },
            }),
          ]}
        >
          <Input
            type="text"
            className="input-small relative"
            placeholder="Token decimal"
          />
        </Form.Item>

        {tokenDecimalsWarning.error || tokenSymbolWarning.error ? (
          <div className="flex flex-col items-center justify-center w-full md:max-w-full">
            <Card type="info" className="border-alert-darkwarning">
              <div>
                <div className="text-xs text-alert-darkwarning font-bold mb-2.5">
                  <p>
                    You are trying to insert data different from the original
                    ones, do you want to continue?
                  </p>
                </div>

                <div className="flex flex-col gap-y-2.5">
                  {tokenSymbolWarning.error ? (
                    <div className="flex flex-col">
                      <p className="text-xs text-alert-darkwarning font-bold mb-1">
                        Token Symbol:{' '}
                      </p>
                      <span className="text-xs">
                        Original value: {tokenMetadataInfos.symbol}
                      </span>
                      <span className="text-xs">
                        Form value: {tokenSymbolWarning.value}
                      </span>
                    </div>
                  ) : null}

                  {tokenDecimalsWarning.error ? (
                    <div className="flex flex-col">
                      <p className="text-xs text-alert-darkwarning font-bold mb-1">
                        Token Decimals:
                      </p>
                      <span className="text-xs">
                        Original value: {tokenMetadataInfos.decimals}
                      </span>
                      <span className="text-xs">
                        Form value: {tokenDecimalsWarning.value}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        <div className="flex flex-col items-center justify-center w-full">
          <div
            className={`${
              tokenDecimalsWarning.error && tokenSymbolWarning.error
                ? 'bottom-6'
                : 'bottom-12'
            } absolute md:static`}
          >
            <NeutralButton
              type="submit"
              disabled={isLoading}
              loading={isLoading}
            >
              Next
            </NeutralButton>
          </div>
        </div>
      </Form>

      {added && (
        <DefaultModal
          show={added}
          title="Token successfully added"
          description={`${form.getFieldValue(
            'symbol'
          )} was successfully added to your wallet.`}
          onClose={() => navigate('/home')}
        />
      )}

      {ercError.errorType !== '' ? (
        <CustomTokenErrorModal
          errorType={ercError.errorType}
          resetErcErrorState={resetErcErrorState}
        />
      ) : null}
    </>
  );
};
