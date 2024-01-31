import { Form, Input } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Modal, NeutralButton } from 'components/index';
import { EditFeeModalBase } from 'components/Modal/EditFeeModalBase';
import { ICustomFeeParams, IFeeState } from 'types/transactions';
import removeScientificNotation from 'utils/removeScientificNotation';

import { PriorityBar } from './components';

interface IEditPriorityModalProps {
  customFee: ICustomFeeParams;
  fee: IFeeState;
  isSendLegacyTransaction?: boolean;
  setCustomFee: React.Dispatch<React.SetStateAction<ICustomFeeParams>>;
  setHaveError: React.Dispatch<React.SetStateAction<boolean>>;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showModal: boolean;
}

export const EditPriorityModal = (props: IEditPriorityModalProps) => {
  const {
    showModal,
    setIsOpen,
    customFee,
    setCustomFee,
    fee,
    setHaveError,
    isSendLegacyTransaction,
  } = props;
  const [priority, setPriority] = useState<number>(1);
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const maxFeePerGas = fee?.maxFeePerGas;
  const maxPriorityFeePerGas = fee?.maxPriorityFeePerGas;
  const gasPrice = fee?.gasPrice;

  const handleSubmit = () => {
    const gasLimitField = form.getFieldValue('gasLimit');
    const maxFeePerGasField = form.getFieldValue('maxFeePerGas');
    const maxPriorityFeePerGasField = form.getFieldValue(
      'maxPriorityFeePerGas'
    );
    const validations = [
      Number(gasLimitField) > 1000,
      Number(maxPriorityFeePerGasField) < Number(maxFeePerGasField),
    ];

    if (
      !isSendLegacyTransaction &&
      validations.every((item) => item === true)
    ) {
      setIsOpen(false);
      setHaveError(false);
      return;
    }

    if (isSendLegacyTransaction && Number(gasLimitField) > 1000) {
      setIsOpen(false);
      setHaveError(false);
      return;
    }
    setHaveError(true);
  };

  useEffect(() => {
    if (!showModal) return;

    switch (priority) {
      case 0:
        if (!isSendLegacyTransaction) {
          form.setFieldValue(
            'maxPriorityFeePerGas',
            removeScientificNotation(0.8 * maxPriorityFeePerGas)
          );
          form.setFieldValue(
            'maxFeePerGas',
            removeScientificNotation(0.8 * maxFeePerGas)
          );
          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: true,
            maxPriorityFeePerGas: 0.8 * maxPriorityFeePerGas,
            maxFeePerGas: 0.8 * maxFeePerGas,
          }));
        } else {
          form.setFieldValue(
            'gasPrice',
            removeScientificNotation(0.8 * gasPrice)
          );

          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: true,
            gasPrice: 0.8 * gasPrice,
          }));
        }
        break;

      case 1:
        if (!isSendLegacyTransaction) {
          form.setFieldValue(
            'maxPriorityFeePerGas',
            removeScientificNotation(1 * maxPriorityFeePerGas)
          );
          form.setFieldValue(
            'maxFeePerGas',
            removeScientificNotation(1 * maxFeePerGas)
          );
          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: false,
            maxPriorityFeePerGas: 1 * maxPriorityFeePerGas,
            maxFeePerGas: 1 * maxFeePerGas,
          }));
        } else {
          form.setFieldValue(
            'gasPrice',
            removeScientificNotation(1 * gasPrice)
          );

          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: false,
            gasPrice: 1 * gasPrice,
          }));
        }
        break;

      case 2:
        if (!isSendLegacyTransaction) {
          form.setFieldValue(
            'maxPriorityFeePerGas',
            removeScientificNotation(1.2 * maxPriorityFeePerGas)
          );
          form.setFieldValue(
            'maxFeePerGas',
            removeScientificNotation(1.2 * maxFeePerGas)
          );
          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: true,
            maxPriorityFeePerGas: 1.2 * maxPriorityFeePerGas,
            maxFeePerGas: 1.2 * maxFeePerGas,
          }));
        } else {
          form.setFieldValue(
            'gasPrice',
            removeScientificNotation(1.2 * gasPrice)
          );

          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: true,
            gasPrice: 1.2 * gasPrice,
          }));
        }
        break;

      default:
        if (!isSendLegacyTransaction) {
          form.setFieldValue(
            'maxPriorityFeePerGas',
            removeScientificNotation(1 * maxPriorityFeePerGas)
          );
          form.setFieldValue(
            'maxFeePerGas',
            removeScientificNotation(1 * maxFeePerGas)
          );
          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: false,
            maxPriorityFeePerGas: 1 * maxPriorityFeePerGas,
            maxFeePerGas: 1 * maxFeePerGas,
          }));
        } else {
          form.setFieldValue(
            'gasPrice',
            removeScientificNotation(1 * gasPrice)
          );

          setCustomFee((prevState) => ({
            ...prevState,
            isCustom: false,
            gasPrice: 1 * gasPrice,
          }));
        }
    }
  }, [priority, fee, showModal, gasPrice, isSendLegacyTransaction]);

  return (
    <EditFeeModalBase
      show={showModal}
      onClose={() => {
        setCustomFee((prevState) => ({
          ...prevState,
          isCustom: false,
          maxPriorityFeePerGas: 1 * maxPriorityFeePerGas,
          maxFeePerGas: 1 * maxFeePerGas,
          gasPrice: 1 * gasPrice,
        }));
        setIsOpen(false);
      }}
    >
      <div className="inline-block align-middle mt-[80px] w-screen h-[519px] text-brand-white font-poppins bg-brand-blue500 rounded-t-[50px] shadow-xl overflow-hidden transform transition-all">
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex py-5 justify-center w-full rounded-t-[50px] bg-[#1c3255]">
            <p className="text-center font-poppins text-base font-medium uppercase">
              {t('send.editFee')}
            </p>
          </div>
          <div className="flex flex-col items-center">
            <div className="flex justify-center w-full my-6">
              <PriorityBar
                priority={priority}
                onClick={(value) => setPriority(value)}
              />
            </div>
            <Form
              validateMessages={{ default: '' }}
              className="flex flex-col gap-3 items-center justify-center my-6 py-2 w-80 md:w-full md:max-w-md"
              name="priority-form"
              id="priority-form"
              labelCol={{ span: 8 }}
              wrapperCol={{ span: 16 }}
              autoComplete="off"
              form={form}
            >
              <div className="flex flex-col items-start justify-center">
                <p className="mb-1 text-sm">{t('send.gasLimit')}</p>
                <Form.Item
                  name="gasLimit"
                  className="text-left"
                  hasFeedback
                  rules={[
                    {
                      required: false,
                      message: t('send.gasLimitMessage'),
                    },
                    () => ({
                      validator(_, value) {
                        if (value > 1000) {
                          return Promise.resolve();
                        }

                        return Promise.reject();
                      },
                    }),
                  ]}
                  initialValue={fee?.gasLimit}
                >
                  <input
                    type="number"
                    placeholder={t('send.gasLimit')}
                    className="custom-gas-input"
                    onChange={(e) =>
                      setCustomFee((prevState) => ({
                        ...prevState,
                        isCustom: true,
                        gasLimit: +e.target.value,
                      }))
                    }
                  />
                </Form.Item>
              </div>

              {!isSendLegacyTransaction ? (
                <>
                  <div className="flex flex-col items-start justify-center">
                    <p className="text-sm text-white mb-1 font-normal">
                      {t('send.maxPriority')} (GWEI)
                    </p>
                    <Form.Item
                      name="maxPriorityFeePerGas"
                      className="text-left"
                      hasFeedback
                      rules={[
                        {
                          required: false,
                          message: '',
                        },
                        () => ({
                          validator(_, value) {
                            if (value < customFee.maxFeePerGas) {
                              return Promise.resolve();
                            }

                            return Promise.reject();
                          },
                        }),
                      ]}
                    >
                      <input
                        type="number"
                        placeholder={`${t('send.maxPriorityFee')} (GWEI)`}
                        className="custom-gas-input"
                        onChange={(e) =>
                          setCustomFee((prevState) => ({
                            ...prevState,
                            isCustom: true,
                            maxPriorityFeePerGas: +e.target.value,
                          }))
                        }
                      />
                    </Form.Item>
                  </div>

                  <div className="flex flex-col items-start justify-center">
                    <p className="text-sm text-white mb-1 font-normal">
                      {t('send.maxFee')} (GWEI)
                    </p>
                    <Form.Item
                      name="maxFeePerGas"
                      className="text-left"
                      hasFeedback
                      rules={[
                        {
                          required: false,
                          message: '',
                        },
                        () => ({
                          validator(_, value) {
                            if (value <= 30 && value >= 1) {
                              return Promise.resolve();
                            }

                            return Promise.reject();
                          },
                        }),
                      ]}
                    >
                      {/* // base fee + priority fee */}
                      <input
                        type="number"
                        placeholder={`${t('send.maxFee')} (GWEI)`}
                        className="custom-gas-input"
                        onChange={(e) =>
                          setCustomFee((prevState) => ({
                            ...prevState,
                            isCustom: true,
                            maxFeePerGas: +e.target.value,
                          }))
                        }
                      />
                    </Form.Item>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-start justify-center">
                  <p className="text-sm text-white mb-1 font-normal">
                    {t('send.gasPrice')} (GWEI)
                  </p>
                  <Form.Item
                    name="gasPrice"
                    className="text-left"
                    hasFeedback
                    rules={[
                      {
                        required: false,
                        message: '',
                      },
                      () => ({
                        validator(_, value) {
                          if (value < customFee.gasPrice) {
                            return Promise.resolve();
                          }

                          return Promise.reject();
                        },
                      }),
                    ]}
                  >
                    <input
                      type="number"
                      placeholder={`${t('send.maxPriorityFee')} (GWEI)`}
                      className="custom-gas-input"
                      onChange={(e) =>
                        setCustomFee((prevState) => ({
                          ...prevState,
                          isCustom: true,
                          gasPrice: +e.target.value,
                        }))
                      }
                    />
                  </Form.Item>
                </div>
              )}
            </Form>
          </div>

          <div className="flex items-center justify-center mt-5 gap-6">
            <Button
              className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-white text-base bg-transparent hover:opacity-60 border border-white rounded-[100px] transition-all duration-300 xl:flex-none"
              type="submit"
              id="confirm_btn"
              onClick={() => setIsOpen(false)}
            >
              {t('buttons.cancel')}
            </Button>
            <Button
              className={`xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none`}
              type="submit"
              id="confirm_btn"
              onClick={handleSubmit}
            >
              {t('buttons.save')}
            </Button>
          </div>
        </div>
      </div>
    </EditFeeModalBase>
  );
};
