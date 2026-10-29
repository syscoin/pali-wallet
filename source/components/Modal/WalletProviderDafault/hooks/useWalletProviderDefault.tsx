import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  getContainerIconStyleAnimation,
  getContainerStyleAnimation,
  getIconStyleAnimation,
} from '../utils/getModalStyleAnimation';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

export const useWalletProviderDefault = () => {
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const { hasEthProperty } = useSelector(
    (state: RootState) => state.vaultGlobal
  );
  const [isHovered, setIsHovered] = useState(false);
  const isEnabled = hasEthProperty;
  const changing = useRef(false);
  const [isNotVisible, setIsNotVisible] = useState(!!isEnabled);

  const containerStyleAnimation = getContainerStyleAnimation(
    isHovered,
    isNotVisible
  );
  const containerIconStyleAnimation = getContainerIconStyleAnimation(isHovered);
  const iconStyleAnimation = getIconStyleAnimation(isHovered);

  const turnPaliAsDefault = async () => {
    if (changing.current) return;
    changing.current = true;
    try {
      // This action is rendered only while Pali is not the default provider.
      await controllerEmitter(['wallet', 'addWindowEthProperty']);
    } catch (error) {
      console.error('Error changing Ethereum provider:', error);
    } finally {
      changing.current = false;
    }
  };

  const icon = useMemo(
    () => (isEnabled ? 'PaliDefault' : 'PaliNotDefault'),
    [isEnabled]
  );

  const modalText = useMemo(
    () =>
      isEnabled ? (
        <span className="text-white text-sm">
          <p>{t('settings.paliProviderEnabled')}</p>
        </span>
      ) : (
        <span className="text-white text-sm ">
          <p>{t('settings.paliProviderDisabled')}</p>
          <button
            type="button"
            className="underline font-bold cursor-pointer focus-visible:ring-2 focus-visible:ring-white"
            onClick={turnPaliAsDefault}
          >
            {t('settings.enablePaliProvider')}
          </button>
        </span>
      ),
    [isEnabled, t]
  );

  useEffect(() => {
    if (isEnabled) {
      const timeoutId = setTimeout(() => {
        setIsNotVisible(true);
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
    setIsNotVisible(false);
  }, [isEnabled]);

  return {
    icon,
    modalText,
    containerStyleAnimation,
    containerIconStyleAnimation,
    iconStyleAnimation,
    isHovered,
    setIsHovered,
    isNotVisible,
  };
};
