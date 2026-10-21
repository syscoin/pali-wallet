import { motion } from 'framer-motion';
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../..';

import { useWalletProviderDefault } from './hooks/useWalletProviderDefault';

export const WalletProviderDefaultModal = () => {
  const {
    containerIconStyleAnimation,
    containerStyleAnimation,
    icon,
    iconStyleAnimation,
    isHovered,
    isNotVisible,
    modalText,
    setIsHovered,
  } = useWalletProviderDefault();
  const { t } = useTranslation();
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => {
    setIsHovered(false);
    opener.current?.focus();
  };

  return (
    <motion.div
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          setIsHovered(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setIsHovered(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      aria-hidden={isNotVisible}
      className="fixed left-0 bottom-0 z-40 bg-brand-blue400 flex"
      style={containerStyleAnimation.style}
      animate={containerStyleAnimation.animation}
    >
      <motion.button
        ref={opener}
        type="button"
        aria-label={t('generalMenu.manageEth')}
        aria-expanded={isHovered && !isNotVisible}
        aria-controls="default-wallet-options"
        disabled={isNotVisible}
        onMouseEnter={() => setIsHovered(true)}
        onClick={() => setIsHovered(!isHovered)}
        className="focus-visible:ring-2 focus-visible:ring-white"
        style={containerIconStyleAnimation.style}
        animate={containerIconStyleAnimation.animation}
      >
        <motion.div
          style={iconStyleAnimation.style}
          animate={iconStyleAnimation.animation}
        >
          <Icon isSvg name={icon} />
        </motion.div>
      </motion.button>
      {isHovered && !isNotVisible && (
        <motion.div
          id="default-wallet-options"
          className="flex items-center p-4 "
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
        >
          {modalText}
          <button
            type="button"
            aria-label={t('buttons.close')}
            className="cursor-pointer focus-visible:ring-2 focus-visible:ring-white"
            onClick={close}
          >
            <Icon isSvg name="Close" />
          </button>
        </motion.div>
      )}
    </motion.div>
  );
};
