import React, { ReactNode } from 'react';

import { FiExternalLink as ExternalLinkIcon } from 'components/Icon/Icon';

export const ExplorerLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => (
  <a
    href={href}
    target="_blank"
    className="flex items-center justify-center gap-x-2"
    rel="noreferrer"
  >
    <ExternalLinkIcon size={16} />
    <span className="font-normal font-poppins underline text-sm">
      {children}
    </span>
  </a>
);
