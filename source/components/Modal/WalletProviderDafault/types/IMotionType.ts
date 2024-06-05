import {
  AnimationControls,
  TargetAndTransition,
  VariantLabels,
} from 'framer-motion';

export type IMotionType =
  | boolean
  | AnimationControls
  | TargetAndTransition
  | VariantLabels;
