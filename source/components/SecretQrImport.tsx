import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CenterPanel,
  DialogBody,
  DialogHeader,
} from 'components/Dialog/Dialog';
import { QrcodeOutlined } from 'components/Icon/Icon';
import { Modal } from 'components/Modal/Modal';
import { parseSecretQr, type SecretQrKind } from 'utils/secretQr';

type Props = {
  disabled?: boolean;
  kind: SecretQrKind;
  onScan(value: string): void;
  restartRecovery?: boolean;
};

const importRoutes = {
  privateKey: '/settings/account/import',
  recoveryPhrase: '/import',
  privateNote: '/privacy',
};

export function SecretQrImport({
  disabled,
  kind,
  restartRecovery,
  onScan,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t('secretQr.scan');
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-brand-royalblue hover:bg-white/10 disabled:opacity-50"
        onClick={() => setOpen(true)}
      >
        <QrcodeOutlined aria-hidden="true" />
      </button>
      {open && !disabled && (
        <SecretQrCamera
          kind={kind}
          restartRecovery={restartRecovery}
          onClose={() => setOpen(false)}
          onScan={(value) => {
            setOpen(false);
            onScan(value);
          }}
        />
      )}
    </>
  );
}

function SecretQrCamera({
  kind,
  restartRecovery,
  onScan,
  onClose,
}: Omit<Props, 'disabled'> & { onClose(): void }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const retire = useRef<() => void>(() => undefined);
  const callbacks = useRef({ onScan, onClose });
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'unavailable' | 'useTab'
  >('loading');
  const [invalid, setInvalid] = useState(false);
  callbacks.current = { onScan, onClose };

  const close = () => {
    retire.current();
    callbacks.current.onClose();
  };

  useEffect(() => {
    const view = video.current;
    if (!view) return;
    const canvas = document.createElement('canvas');
    const frame = canvas.getContext('2d', { willReadFrequently: true });
    let live = true;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      live = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      view.srcObject = null;
      canvas.width = canvas.height = 0;
    };
    retire.current = stop;

    const closeCamera = () => {
      stop();
      callbacks.current.onClose();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') closeCamera();
    };
    const onBlur = () => {
      // A camera prompt can briefly take focus before access is granted.
      if (stream) closeCamera();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', closeCamera);
    window.addEventListener('blur', onBlur);

    const start = async () => {
      try {
        if (document.documentElement.dataset.paliView === 'toolbar-popup') {
          // Chrome can grant a camera prompt from a tab, not the toolbar popup.
          const permission = await navigator.permissions
            ?.query({ name: 'camera' as PermissionName })
            .catch(() => undefined);
          if (!live) return;
          if (permission?.state !== 'granted') {
            setStatus('useTab');
            return;
          }
        }
        if (!frame || !navigator.mediaDevices?.getUserMedia)
          throw new Error('Camera unavailable');
        const { default: decode } = await import('jsqr');
        if (!live) return;
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        if (!live) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = acquired;
        view.srcObject = acquired;
        await view.play();
        if (!live) return;
        setStatus('ready');

        const scan = () => {
          if (!live) return;
          try {
            if (document.hasFocus() && view.videoWidth && view.videoHeight) {
              const scale = Math.min(
                1,
                640 / Math.max(view.videoWidth, view.videoHeight)
              );
              canvas.width = Math.max(1, Math.round(view.videoWidth * scale));
              canvas.height = Math.max(1, Math.round(view.videoHeight * scale));
              frame.drawImage(view, 0, 0, canvas.width, canvas.height);
              const pixels = frame.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
              );
              const result = decode(pixels.data, canvas.width, canvas.height);
              if (result) {
                const value = parseSecretQr(result.data, kind);
                if (value !== null) {
                  stop();
                  callbacks.current.onScan(value);
                  return;
                }
                setInvalid(true);
              }
            }
          } catch {
            stop();
            setStatus('unavailable');
            return;
          }
          timer = setTimeout(scan, 150);
        };
        scan();
      } catch {
        if (!live) return;
        stop();
        setStatus('unavailable');
      }
    };
    void start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', closeCamera);
      window.removeEventListener('blur', onBlur);
    };
  }, [kind]);

  return (
    <Modal onClose={close}>
      <CenterPanel padded={false} className="flex flex-col">
        <DialogHeader title={t('secretQr.scan')} onClose={close} />
        <DialogBody>
          <video
            ref={video}
            muted
            playsInline
            className="aspect-square w-full rounded-lg bg-black object-cover"
            hidden={status !== 'ready'}
            aria-hidden="true"
          />
          <p role="status" className="mt-2 text-sm text-brand-graylight">
            {status === 'unavailable' || status === 'useTab'
              ? t('secretQr.cameraUnavailable')
              : t(invalid ? 'secretQr.scanInvalid' : 'secretQr.scanHelp')}
          </p>
          {status === 'useTab' && (
            <a
              className="mt-3 inline-block text-sm text-brand-royalblue underline"
              href={chrome.runtime.getURL(
                `app.html#${restartRecovery ? '/' : importRoutes[kind]}`
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('send.openWalletTab')}
            </a>
          )}
        </DialogBody>
      </CenterPanel>
    </Modal>
  );
}
