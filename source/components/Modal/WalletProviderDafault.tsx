import {
  AnimationControls,
  MotionStyle,
  TargetAndTransition,
  VariantLabels,
  motion,
} from 'framer-motion';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from '..';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const WalletProviderDafault = () => {
  const { hasEthProperty } = useSelector((state: RootState) => state.vault);
  const [isHovered, setIsHovered] = useState(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(hasEthProperty);
  const [isNotVisible, setIsNotVisible] = useState(!!isEnabled);

  const containerStyleAnimation = {
    style: {
      width: isHovered ? `100vw` : `2.75rem`,
      height: isHovered ? `64px` : `2.75rem`,
      borderTopRightRadius: isHovered ? `20px` : `999px`,
      borderTopLeftRadius: isHovered ? `20px` : `unset`,
      opacity: isNotVisible ? 0 : 1,
    } as MotionStyle,
    animation: {
      width: isHovered ? `100vw` : `2.75rem`,
      height: isHovered ? `64px` : `2.75rem`,
      borderTopRightRadius: isHovered ? `20px` : `999px`,
      borderTopLeftRadius: isHovered ? `20px` : `unset`,
      opacity: isNotVisible ? 0 : 1,
      transition: {
        duration: 0.3,
        ease: 'easeInOut',
      },
    } as boolean | AnimationControls | TargetAndTransition | VariantLabels,
  };

  const containerIconStyleAnimation = {
    style: {
      width: isHovered ? `55px` : `2.75rem`,
      backgroundColor: isHovered ? `#476DAA` : `#4d76b8`,
      borderTopRightRadius: isHovered ? `unset` : `999px`,
      borderTopLeftRadius: isHovered ? `20px` : `unset`,
    } as MotionStyle,
    animation: {
      backgroundColor: isHovered ? `#476DAA` : `#4d76b8`,
      borderTopRightRadius: isHovered ? `unset` : `999px`,
      borderTopLeftRadius: isHovered ? `20px` : `unset`,
      transition: {
        duration: 0.3,
        ease: 'easeInOut',
      },
    } as boolean | AnimationControls | TargetAndTransition | VariantLabels,
  };

  const iconStyleAnimation = {
    style: {
      position: `absolute`,
      left: isHovered ? `15px` : `5px`,
      bottom: isHovered ? `18px` : `6px`,
    } as MotionStyle,
    animation: {
      position: `absolute`,
      left: isHovered ? `15px` : `5px`,
      bottom: isHovered ? `18px` : `6px`,
    } as boolean | AnimationControls | TargetAndTransition | VariantLabels,
  };

  const controller = getController();

  const turnPaliAsDefault = () => {
    setIsEnabled(!isEnabled);
    switch (isEnabled) {
      case true:
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
        break;
      case false:
        controller.wallet.addWindowEthProperty();
        controller.wallet.setHasEthProperty(true);
        break;
      default:
        break;
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
          <p>WalletName is in use and Pali is banned. </p>
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

  return (
    <motion.div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="fixed left-0 bottom-0 z-[9999] bg-brand-blue400 flex"
      style={containerStyleAnimation.style}
      animate={containerStyleAnimation.animation}
    >
      <motion.div
        style={containerIconStyleAnimation.style}
        animate={containerIconStyleAnimation.animation}
      >
        <motion.div
          style={iconStyleAnimation.style}
          animate={iconStyleAnimation.animation}
        >
          <Icon isSvg name={icon} />
        </motion.div>
      </motion.div>
      {isHovered && (
        <motion.div
          className="flex items-center p-4 "
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
        >
          {modalText}
          <span className="cursor-pointer" onClick={() => setIsHovered(false)}>
            <Icon isSvg name="Close" />
          </span>
        </motion.div>
      )}
    </motion.div>
  );
};
