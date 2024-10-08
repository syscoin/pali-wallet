import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  getContainerIconStyleAnimation,
  getContainerStyleAnimation,
  getIconStyleAnimation,
} from '../utils/getModalStyleAnimation';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

export const useWalletProviderDefault = () => {
  const { controllerEmitter } = useController();
  const { hasEthProperty } = useSelector((state: RootState) => state.vault);
  const [isHovered, setIsHovered] = useState(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(hasEthProperty);
  const [isNotVisible, setIsNotVisible] = useState(!!isEnabled);

  const containerStyleAnimation = getContainerStyleAnimation(
    isHovered,
    isNotVisible
  );
  const containerIconStyleAnimation = getContainerIconStyleAnimation(isHovered);
  const iconStyleAnimation = getIconStyleAnimation(isHovered);

  const turnPaliAsDefault = () => {
    setIsEnabled(!isEnabled);
    if (isEnabled) {
      controllerEmitter(['wallet', 'removeWindowEthProperty']);

      controllerEmitter(['wallet', 'setHasEthProperty'], [false]);

      controllerEmitter(['dapp', 'getAll']).then(async (response) => {
        const dapps = Object.values(response);

        if (dapps.length) {
          for (const dapp of dapps) {
            await controllerEmitter(['dapp', 'isConnected'], [dapp.host]).then(
              async (isConnected: boolean) => {
                if (isConnected) {
                  await controllerEmitter(['dapp', 'disconnect'], [dapp.host]);
                }
              }
            );
          }
        }
      });
    } else {
      controllerEmitter(['wallet', 'addWindowEthProperty']);
      controllerEmitter(['wallet', 'setHasEthProperty'], [true]);
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
