import { MotionStyle } from 'framer-motion';

import { IMotionType } from '../types/IMotionType';

export const getContainerStyleAnimation = (
  isHovered: boolean,
  isNotVisible: boolean
) => ({
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
  } as IMotionType,
});

export const getContainerIconStyleAnimation = (isHovered: boolean) => ({
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
  } as IMotionType,
});

export const getIconStyleAnimation = (isHovered: boolean) => ({
  style: {
    position: `absolute`,
    left: isHovered ? `15px` : `5px`,
    bottom: isHovered ? `18px` : `6px`,
  } as MotionStyle,
  animation: {
    position: `absolute`,
    left: isHovered ? `15px` : `5px`,
    bottom: isHovered ? `18px` : `6px`,
  } as IMotionType,
});
