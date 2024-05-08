import { motion } from 'framer-motion';
import React from 'react';

import { Icon } from '../..';

import { useWalletProviderDefault } from './hooks/useWalletProviderDefault';

export const WalletProviderDefaultModal = () => {
  const {
    containerIconStyleAnimation,
    containerStyleAnimation,
    icon,
    iconStyleAnimation,
    isHovered,
    modalText,
    setIsHovered,
  } = useWalletProviderDefault();

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
