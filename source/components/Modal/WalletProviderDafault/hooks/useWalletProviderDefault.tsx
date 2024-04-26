import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  getContainerIconStyleAnimation,
  getContainerStyleAnimation,
  getIconStyleAnimation,
} from '../utils/getModalStyleAnimation';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const useWalletProviderDefault = () => {
  const { hasEthProperty } = useSelector((state: RootState) => state.vault);
  const [isHovered, setIsHovered] = useState(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(hasEthProperty);
  const [isNotVisible, setIsNotVisible] = useState(!!isEnabled);

  const controller = getController();

  const containerStyleAnimation = getContainerStyleAnimation(
    isHovered,
    isNotVisible
  );
  const containerIconStyleAnimation = getContainerIconStyleAnimation(isHovered);
  const iconStyleAnimation = getIconStyleAnimation(isHovered);

  const turnPaliAsDefault = () => {
    setIsEnabled(!isEnabled);
    if (isEnabled) {
      controller.wallet.removeWindowEthProperty();
      controller.wallet.setHasEthProperty(false);
      const dapps = Object.values(controller.dapp.getAll());
      // disconnect from all dapps when remove window.ethereum property
      if (dapps.length) {
        for (const dapp of dapps) {
          if (controller.dapp.isConnected(dapp.host))
            controller.dapp.disconnect(dapp.host);
        }
      }
    } else {
      controller.wallet.addWindowEthProperty();
      controller.wallet.setHasEthProperty(true);
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
          <p>Pali was successfully set as the default wallet!</p>
        </span>
      ) : (
        <span className="text-white text-sm ">
          <p>Metamask is in use and Pali is banned. </p>
          <p
            className="underline font-bold cursor-pointer"
            onClick={turnPaliAsDefault}
          >
            Set Pali as default wallet!
          </p>
        </span>
      ),
    [isEnabled]
  );

  useEffect(() => {
    if (isEnabled) {
      const timeoutId = setTimeout(() => {
        setIsNotVisible(true);
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [isEnabled]);

  return {
    icon,
    modalText,
    containerStyleAnimation,
    containerIconStyleAnimation,
    iconStyleAnimation,
    isHovered,
    setIsHovered,
    isEnabled,
    setIsEnabled,
    isNotVisible,
    setIsNotVisible,
  };
};
