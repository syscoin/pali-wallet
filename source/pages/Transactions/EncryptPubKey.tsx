import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent } from 'utils/browser';

import { EncryptionReview } from './EncryptionReview';

interface ISign {
  send?: boolean;
}

const EncryptPubKey: React.FC<ISign> = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const { alert } = useUtils();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const { address } = activeAccount;
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const copyScope = JSON.stringify([
    activeAccountMeta,
    address,
    activeNetwork.kind,
    activeNetwork.chainId,
    activeNetwork.url,
    activeNetwork.apiUrl,
    host,
    data.eventName,
    data[0],
  ]);
  const copyScopeRef = useRef(copyScope);
  copyScopeRef.current = copyScope;
  const copyContext = useRef({ active: true, sequence: 0 });
  useEffect(() => {
    copyContext.current.active = true;
    return () => {
      copyContext.current.active = false;
      copyContext.current.sequence += 1;
    };
  }, [copyScope]);

  const copyAddress = async () => {
    if (!copyContext.current.active || copyScopeRef.current !== copyScope)
      return;
    const sequence = ++copyContext.current.sequence;
    const isCurrent = () =>
      copyContext.current.active &&
      copyScopeRef.current === copyScope &&
      copyContext.current.sequence === sequence;
    try {
      await navigator.clipboard.writeText(address);
      if (isCurrent()) alert.info(t('home.addressCopied'));
    } catch {
      if (isCurrent()) alert.error(t('transactions.copyFailed'));
    }
  };

  const onSubmit = async () => {
    if (!copyContext.current.active || copyScopeRef.current !== copyScope)
      return;
    setLoading(true);
    const type = data.eventName;
    try {
      if (
        typeof data[0] !== 'string' ||
        data[0].toLowerCase() !== address.toLowerCase()
      )
        throw new Error('Requested account is not active');
      const response = await controllerEmitter(
        ['wallet', 'getEncryptionPublicKeyForAccount'],
        [data[0]]
      );
      dispatchBackgroundEvent(`${type}.${host}`, response);
      if (!copyContext.current.active) return;
      setConfirmed(true);

      setLoading(false);
      window.close();
    } catch (error: any) {
      if (!copyContext.current.active) return;
      setErrorMsg(error.message || 'Failed to get encryption key');
      setLoading(false);
    }
  };

  return (
    <EncryptionReview
      account={activeAccount}
      confirmed={confirmed}
      description={t('transactions.wouldLikeYourPubEncryption')}
      errorMsg={errorMsg}
      host={host}
      loading={loading}
      onCopy={() => void copyAddress()}
      onSubmit={onSubmit}
      title={t('send.encryptKey')}
    />
  );
};

export default EncryptPubKey;
