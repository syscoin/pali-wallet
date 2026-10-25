import { Dialog } from '@headlessui/react';
import { AdjustmentsIcon } from '@heroicons/react/outline';
import { Form, Input, Radio, RadioChangeEvent } from 'antd';
import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CenterPanel,
  DialogActionButton,
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogPrimitive,
} from 'components/Dialog/Dialog';
import {
  ICustomApprovedAllowanceAmount,
  IIsEditedAllowanceModalProps,
} from 'types/transactions';

import { parseApprovalAmount } from './approval';

export const EditApprovedAllowanceValueModal = (
  props: IIsEditedAllowanceModalProps
) => {
  const {
    host,
    customApprovedAllowanceAmount,
    approvedTokenInfos,
    showModal,
    setCustomApprovedAllowanceAmount,
    setOpenEditFeeModal,
  } = props;
  const { t } = useTranslation();
  const [formControlEditedFee] = Form.useForm();
  const inputId = useId();
  const [currentRadioChecked, setCurrentRadioChecked] =
    useState('proposed_limit');
  const wasOpen = useRef(false);
  const editorGeneration = useRef(0);
  const restoreSavedAllowance = () => {
    const radio = customApprovedAllowanceAmount.isCustom
      ? 'custom_limit'
      : 'proposed_limit';
    setCurrentRadioChecked(radio);
    formControlEditedFee.setFieldsValue({
      radio_group: radio,
      custom_limit_input_value:
        customApprovedAllowanceAmount.customAllowanceValue ?? '',
    });
  };
  useEffect(() => {
    if (!showModal) {
      if (wasOpen.current) editorGeneration.current += 1;
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    editorGeneration.current += 1;
    restoreSavedAllowance();
  }, [showModal, customApprovedAllowanceAmount, formControlEditedFee]);
  useEffect(
    () => () => {
      wasOpen.current = false;
      editorGeneration.current += 1;
    },
    []
  );

  const close = () => {
    wasOpen.current = false;
    editorGeneration.current += 1;
    restoreSavedAllowance();
    setOpenEditFeeModal(false);
  };

  const onSubmitForm = async () => {
    if (!showModal || !wasOpen.current) return;
    const generation = editorGeneration.current;
    let data;
    try {
      data = await formControlEditedFee.validateFields();
    } catch {
      // The form renders validation errors inline.
      return;
    }
    // Validation can settle after dismissal or a newer editor session.
    if (!wasOpen.current || generation !== editorGeneration.current) return;
    wasOpen.current = false;
    editorGeneration.current += 1;
    setCustomApprovedAllowanceAmount(
      (prevState: ICustomApprovedAllowanceAmount) => ({
        ...prevState,
        isCustom: data.radio_group === 'custom_limit',
        customAllowanceValue:
          data.radio_group === 'custom_limit'
            ? data.custom_limit_input_value
            : '',
      })
    );

    setOpenEditFeeModal(false);

    return;
  };

  const changeInputRadioValue = (event: RadioChangeEvent) => {
    setCurrentRadioChecked(event.target.value);
  };

  return (
    <DialogPrimitive show={showModal} onClose={close}>
      <CenterPanel padded={false} scroll={false} className="flex flex-col">
        <DialogHeader
          title={t('send.spendingLimit')}
          icon={<AdjustmentsIcon />}
          onClose={close}
        />
        <DialogBody>
          <div className="flex min-w-0 flex-col items-center justify-center w-full">
            <div className="grid min-w-0 w-full gap-y-4 grid-cols-1 auto-cols-auto">
              <div className="grid items-center">
                <Dialog.Description className="[overflow-wrap:anywhere] text-left text-content-secondary text-sm">
                  {`${t('send.allow')} ${host} ${t('send.toWithdraw')}`}:
                </Dialog.Description>
              </div>
              <Form
                form={formControlEditedFee}
                onSubmitCapture={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onSubmitForm();
                }}
              >
                <Form.Item
                  id="radio_group"
                  name="radio_group"
                  initialValue={currentRadioChecked}
                >
                  <Radio.Group
                    id="radioGroup"
                    name="radioGroup"
                    onChange={changeInputRadioValue}
                  >
                    <div className="grid gap-y-2 items-center mb-6 mt-2 text-sm">
                      <div className="flex items-center">
                        <Radio
                          value="proposed_limit"
                          name="proposed_limit"
                          id="proposed_limit"
                        />

                        <label
                          htmlFor="proposed_limit"
                          className="ml-2 flex min-h-[44px] cursor-pointer items-center font-bold"
                        >
                          {t('send.proposedApprovalLimit')}
                        </label>
                      </div>
                      <div className="flex flex-col gap-y-2 pl-5 text-left">
                        <span className="[overflow-wrap:anywhere]">
                          {t('send.spendingLimitRequestedBy')} {host}
                        </span>
                        <span className="break-all">
                          {customApprovedAllowanceAmount?.defaultAllowanceValue}
                          <span className="ml-1 text-content-primary font-semibold">
                            {approvedTokenInfos?.tokenSymbol}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-y-2 items-center mb-6 text-left text-sm">
                      <div className="flex items-center">
                        <Radio
                          value="custom_limit"
                          name="custom_limit"
                          id="custom_limit"
                        />

                        <label
                          htmlFor="custom_limit"
                          className="ml-2 flex min-h-[44px] cursor-pointer items-center font-bold"
                        >
                          {t('send.customSpendingLimit')}
                        </label>
                      </div>
                      <div className="grid gap-y-2 pl-5">
                        <label htmlFor={inputId}>
                          {t('send.enterAMaximumSpendingLimit')}
                        </label>
                        <Form.Item
                          id="custom_limit_input_value"
                          name="custom_limit_input_value"
                          rules={[
                            {
                              required: currentRadioChecked === 'custom_limit',
                            },
                            {
                              validator: (_, value) =>
                                currentRadioChecked !== 'custom_limit' ||
                                parseApprovalAmount(
                                  String(value ?? ''),
                                  approvedTokenInfos?.tokenDecimals
                                ) !== null
                                  ? Promise.resolve()
                                  : Promise.reject(
                                      new Error(t('send.invalidAmount'))
                                    ),
                            },
                          ]}
                        >
                          <Input
                            id={inputId}
                            type="text"
                            placeholder={String(
                              customApprovedAllowanceAmount?.defaultAllowanceValue
                            )}
                            className={`px-4 py-2 text-brand-graylight ${
                              currentRadioChecked === 'custom_limit'
                                ? 'border bg-transparent border-slate-400'
                                : ''
                            } rounded outline-none focus-visible:ring-2 focus-visible:ring-content-primary`}
                            disabled={currentRadioChecked !== 'custom_limit'}
                          />
                        </Form.Item>
                      </div>
                    </div>
                  </Radio.Group>
                </Form.Item>
              </Form>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogActions>
            <DialogActionButton tone="secondary" type="button" onClick={close}>
              {t('buttons.cancel')}
            </DialogActionButton>
            <DialogActionButton
              tone="primary"
              type="button"
              id="confirm_btn"
              onClick={onSubmitForm}
            >
              {t('buttons.save')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </CenterPanel>
    </DialogPrimitive>
  );
};
