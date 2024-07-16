import { Switch } from '@headlessui/react';
import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { validateEthRpc, validateSysRpc } from '@pollum-io/sysweb3-network';

import checkAtIcon from 'assets/icons/checkAt.svg';
import { Button, Layout, Tooltip } from 'components/index';
import { StatusModal } from 'components/Modal/StatusModal';
import { RPCSuccessfullyAdded } from 'components/Modal/WarningBaseModal';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ICustomRpcParams } from 'types/transactions';
import { getController } from 'utils/browser';
import { NetworkType } from 'utils/types';

const CustomRPCView = () => {
  const { state }: { state: any } = useLocation();
  const { t } = useTranslation();
  const isSyscoinSelected = state && state.chain && state.chain === 'syscoin';
  const [loading, setLoading] = useState(false);
  const [isUrlValid, setIsUrlValid] = useState(false);
  const [urlFieldValue, setUrlFieldValue] = useState('');
  const [addedRpc, setAddedRpc] = useState<boolean>(false);
  const [showModal, setShowModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState<string>('');
  const [lastRpcChainIdSearched, setLastRpcChainIdSearched] = useState<
    number | null
  >(null);
  const [isSyscoinRpc, setIsSyscoinRpc] = useState(Boolean(isSyscoinSelected));
  const { activeNetwork, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const { wallet } = getController();
  const { alert, navigate } = useUtils();
  const controller = getController();

  const [form] = useForm();

  const switchBallStyle = isSyscoinRpc
    ? 'translate-x-6 bg-brand-deepPink100'
    : 'translate-x-1  bg-brand-blue200';

  const inputHiddenOrNotStyle = isSyscoinRpc ? 'hidden' : 'relative';

  const modalMessageOnSuccessful = state
    ? t('settings.rpcSucessfullyEdited')
    : t('settings.rpcSucessfullyAdded');

  const populateForm = (field: string, value: number | string) => {
    if (!form.getFieldValue(field)) form.setFieldsValue({ [field]: value });
  };

  const closeModal = () => {
    setShowModal(false);
  };

  const onSubmit = async (data: ICustomRpcParams) => {
    setLoading(true);

    const customRpc = {
      ...data,
      isSyscoinRpc,
    };

    try {
      if (!state) {
        await controller.wallet.addCustomRpc(customRpc);
        setLoading(false);
        setAddedRpc(true);
        return;
      }

      await controller.wallet.editCustomRpc(customRpc, state.selected);
      setLoading(false);
      setAddedRpc(true);
    } catch (error: any) {
      alert.removeAll();
      setAddedRpc(false);
      setShowModal(true);
      setLoading(false);
      setErrorModalMessage(error.message);
    }
  };

  const resetFormValues = () => {
    form.setFieldValue('label', '');
    form.setFieldValue('chainId', '');
    form.setFieldValue('symbol', '');
    form.setFieldValue('explorer', '');
  };

  const initialValues = {
    label: (state && state.selected && state.selected.label) ?? '',
    url: (state && state.selected && state.selected.url) ?? '',
    chainId: (state && state.selected && state.selected.chainId) ?? '',
    symbol: (state && state.selected && state.selected.currency) ?? '',
    explorer: (state && state.selected && state.selected.url) ?? '',
  };

  const isInputDisableByEditMode = state ? state.isDefault : false;

  const isInputDisabled = Boolean(
    !form.getFieldValue('url') ||
      isUrlValid ||
      (state && state.selected && state.selected.chainId)
  );

  useEffect(() => {
    const fieldErrors = form.getFieldError('url');
    if (urlFieldValue && fieldErrors.length > 0) {
      alert.removeAll();
      setErrorModalMessage(t('settings.invalidRpcUrl'));
    }
  }, [urlFieldValue]);

  const handleConnect = async (data: ICustomRpcParams) => {
    await wallet.setActiveNetwork(data, String(activeNetwork.chainId));
  };
  return (
    <Layout title={state?.isEditing ? 'EDIT RPC' : t('settings.customRpc')}>
      <RPCSuccessfullyAdded
        show={addedRpc}
        title={t('titles.congratulations')}
        phraseOne={modalMessageOnSuccessful}
        onClose={() => navigate('/settings/networks/edit')}
      />
      <StatusModal
        status="error"
        title="Erro"
        description={errorModalMessage}
        onClose={closeModal}
        show={showModal}
      />
      <Form
        form={form}
        validateMessages={{ default: '' }}
        id="rpc"
        name="rpc"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={initialValues}
        onFinish={state?.isEditing ? handleConnect : onSubmit}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center"
      >
        <Form.Item
          id="network-switch"
          name="network-switch"
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          {state?.isEditing ? (
            <p
              className={`text-sm ${
                isBitcoinBased ? 'text-brand-pink200' : 'text-brand-blue200'
              }`}
            >
              {isBitcoinBased ? NetworkType.UTXO : NetworkType.EVM} Network
            </p>
          ) : (
            <div className="flex gap-x-2 mb-4 text-xs">
              <p className="text-brand-blue200 text-xs">EVM</p>
              <Tooltip
                content={
                  !!state ? 'Cant change type of network while editing' : ''
                }
              >
                <Switch
                  checked={isSyscoinRpc}
                  onChange={() => setIsSyscoinRpc(!isSyscoinRpc)}
                  className="relative inline-flex items-center w-9 h-4 border border-white rounded-full"
                  disabled={!!state}
                >
                  <span className="sr-only">Syscoin Network</span>
                  <span
                    className={`${switchBallStyle} inline-block w-2 h-2 transform rounded-full`}
                  />
                </Switch>
              </Tooltip>

              <p className="text-brand-deepPink100 text-xs">UTXO</p>
            </div>
          )}
        </Form.Item>

        <Form.Item
          name="label"
          className="md:w-full"
          hasFeedback
          rules={[
            {
              required: !isSyscoinRpc,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            disabled={isInputDisableByEditMode}
            placeholder={`${t('settings.label')} ${
              isSyscoinRpc ? `(${t('settings.label')})` : ''
            }`}
            className="custom-input-normal relative"
          />
        </Form.Item>

        <Form.Item
          name="url"
          className="md:w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              async validator(_, value) {
                setUrlFieldValue(value);
                if (isSyscoinRpc) {
                  const trezorIoRegExp = /trezor\.io/;
                  if (trezorIoRegExp.test(value)) {
                    console.error(
                      "trezor.io has a rate limit for simultaneous requests, so we can't use it for now"
                    );
                    alert.error(t('settings.trezorSiteWarning'));
                    return Promise.reject();
                  }
                  const { valid, coin } = await validateSysRpc(value);

                  if (valid || !value) {
                    populateForm('label', String(coin));

                    return Promise.resolve();
                  }

                  return Promise.reject();
                }

                const { valid, details, hexChainId } = await validateEthRpc(
                  value,
                  false
                ); //Cooldown doesn't matter on network edition

                setIsUrlValid(valid);

                //We have to use the value from the state if exists because we have to validate the
                //rpc from networks that is already added too
                if (state && state.selected.chainId) {
                  const stateChainId = state.selected.chainId;

                  const rpcChainId = details
                    ? details.chainId
                    : Number(String(parseInt(hexChainId, 16)));

                  if (stateChainId === rpcChainId) {
                    return Promise.resolve();
                  } else {
                    return Promise.reject();
                  }
                }

                //If no RPC was searched yet
                if (!state && lastRpcChainIdSearched === null) {
                  if ((valid && details) || !value) {
                    populateForm('label', String(details.name));
                    populateForm('chainId', String(details.chainId));

                    setLastRpcChainIdSearched(details.chainId);

                    return Promise.resolve();
                  } else if (valid || !value) {
                    const chainIdConvertedOne = String(
                      parseInt(hexChainId, 16)
                    );

                    populateForm('chainId', chainIdConvertedOne);

                    setLastRpcChainIdSearched(Number(chainIdConvertedOne));
                    return Promise.resolve();
                  }
                } else {
                  const chainIdConvertedTwo = String(parseInt(hexChainId, 16));
                  //Here if already had search for any RPC we have to validate if the result
                  //for the new one is for the same chainID or not, if is just keep the older values
                  //filled and give a valid for the new rpc url
                  if (
                    (details && lastRpcChainIdSearched === details.chainId) ||
                    lastRpcChainIdSearched === Number(chainIdConvertedTwo)
                  ) {
                    return Promise.resolve();
                  } else {
                    //If is not valid we reset the form values and fill with the new and correct ones
                    resetFormValues();

                    if (valid && details) {
                      populateForm('label', String(details.name));
                      populateForm('chainId', String(details.chainId));

                      setLastRpcChainIdSearched(details.chainId);

                      return Promise.resolve();
                    } else if (valid) {
                      const chainIdConvertedThree = String(
                        parseInt(hexChainId, 16)
                      );
                      populateForm('chainId', chainIdConvertedThree);

                      setLastRpcChainIdSearched(Number(chainIdConvertedThree));
                      return Promise.resolve();
                    }
                  }
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder={`${isSyscoinRpc ? 'Explorer' : 'RPC URL'}`}
            className="custom-input-normal relative"
          />
        </Form.Item>

        <Form.Item
          name="chainId"
          hasFeedback
          className="md:w-full"
          rules={[
            {
              required: !isSyscoinRpc,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            disabled={isInputDisabled}
            placeholder="Chain ID"
            className={`${inputHiddenOrNotStyle} custom-input-normal `}
          />
        </Form.Item>

        <Form.Item
          name="symbol"
          hasFeedback
          className="md:w-full"
          rules={[
            {
              required: !isSyscoinRpc,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.symbol')}
            className={`${inputHiddenOrNotStyle} custom-input-normal relative`}
          />
        </Form.Item>

        <Form.Item
          hasFeedback
          className="md:w-full"
          name="explorer"
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.explorer')}
            className={`${inputHiddenOrNotStyle} custom-input-normal `}
          />
        </Form.Item>
        {state?.isEditing ? (
          <div
            className="flex justify-center items-center gap-2 cursor-pointer"
            onClick={() => (window.location.href = 'https://chainlist.org/')}
          >
            <img
              src={checkAtIcon}
              alt="Check at chainlist"
              onClick={() => (window.location.href = 'https://chainlist.org/')}
            />
            <p
              className="underline text-center text-white font-poppins text-sm"
              onClick={() => (window.location.href = 'https://chainlist.org/')}
            >
              Check chainlist
            </p>
          </div>
        ) : (
          <p className="px-8 py-4 text-center text-brand-royalblue font-poppins text-xs">
            {t('settings.youCanEdit')}
          </p>
        )}
        {state?.isEditing ? (
          <div className="flex gap-6 justify-between mt-[2.313rem]">
            <Button
              type="submit"
              className="bg-transparent rounded-[100px] w-[10.25rem] h-[40px] text-white text-base font-medium border border-white"
              onClick={() => navigate('/chain-fail-to-connect')}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-white rounded-[100px] w-[10.25rem] h-[40px] text-brand-blue400 text-base font-medium"
            >
              Connect
            </Button>
          </div>
        ) : (
          <div className="absolute bottom-10 md:static">
            <Button
              className="xl:p-18 h-[40px] w-[352px] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none"
              type="submit"
              loading={loading}
            >
              {t('buttons.save')}
            </Button>
          </div>
        )}
      </Form>
    </Layout>
  );
};

export default CustomRPCView;
