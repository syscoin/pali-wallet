import React from 'react';

import { useToastFooter } from 'hooks/useToastFooter';

/** Keep transient feedback above a fixed or sticky action area. */
export const ToastActionFooter = (
  props: React.HTMLAttributes<HTMLDivElement>
) => {
  const ref = useToastFooter();
  return <div {...props} ref={ref} />;
};
