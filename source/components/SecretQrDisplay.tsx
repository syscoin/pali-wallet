import { QRCodeCanvas } from 'qrcode.react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { QrcodeOutlined } from './Icon/Icon';

interface ISecretQrDisplayProps {
  children: React.ReactNode;
  isCurrent?: () => boolean;
  secret: string;
}

/** Mount this only while the surrounding disclosure is authorized and visible. */
export function SecretQrDisplay({
  children,
  isCurrent,
  secret,
}: ISecretQrDisplayProps) {
  const { t } = useTranslation();
  const [showQr, setShowQr] = useState(false);
  if (isCurrent && !isCurrent()) return null;

  return (
    <>
      {showQr ? (
        <QRCodeCanvas
          value={secret}
          role="img"
          aria-label={t('secretQr.visible')}
          size={224}
          includeMargin
          className="mx-auto block max-w-full rounded bg-white"
          style={{ height: 'auto' }}
        />
      ) : (
        children
      )}
      <button
        type="button"
        onClick={() => {
          if (isCurrent?.() ?? true) setShowQr(!showQr);
        }}
        className="mt-2 inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        <QrcodeOutlined aria-hidden="true" />
        {t(showQr ? 'secretQr.hide' : 'secretQr.show')}
      </button>
    </>
  );
}
