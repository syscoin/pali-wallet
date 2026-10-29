import { Dialog } from '@headlessui/react';
import { SparklesIcon } from '@heroicons/react/outline';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ChainIcon } from 'components/ChainIcon';
import {
  CenterPanel,
  DialogActionButton,
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogPrimitive,
} from 'components/Dialog/Dialog';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { faucetNetworkData } from 'utils/constants';

export const FaucetFirstAccessModal = ({
  onClose,
}: {
  onClose: () => void;
}) => {
  const { navigate } = useUtils();
  const { t } = useTranslation();

  const {
    activeNetwork: { chainId, kind },
  } = useSelector((state: RootState) => state.vault);

  const currentNetworkData = faucetNetworkData?.[chainId];

  return (
    <DialogPrimitive show onClose={onClose}>
      <CenterPanel padded={false} scroll={false} className="flex flex-col">
        <DialogHeader
          className="faucet-title"
          title={t('faucet.firstAccessTitle', {
            token: currentNetworkData?.token,
            network: currentNetworkData?.network,
          })}
          icon={<SparklesIcon />}
          onClose={onClose}
        />
        <DialogBody className="flex flex-col items-center gap-4">
          <ChainIcon
            chainId={chainId}
            size={80}
            className=""
            networkKind={kind}
          />

          <Dialog.Description className="text-sm text-center text-content-secondary">
            {t('faucet.firstAccessDescription', {
              token: currentNetworkData?.token,
            })}
          </Dialog.Description>
        </DialogBody>
        <DialogFooter>
          <DialogActions>
            <DialogActionButton
              tone="primary"
              type="button"
              onClick={() => {
                navigate('/faucet');
                onClose();
              }}
            >
              {t('faucet.grabTokens')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </CenterPanel>
    </DialogPrimitive>
  );
};
