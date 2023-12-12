import React from 'react';

export const useAdjustedExplorer = (explorer: string) =>
  React.useMemo(
    () => (explorer?.endsWith('/') ? explorer : `${explorer}/`),
    [explorer]
  );
