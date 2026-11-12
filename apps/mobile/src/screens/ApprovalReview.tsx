import { useNativeTranslation } from '../platform/localization';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  formatApprovalTokenAmount,
  parseApprovalAmount,
  type ApprovalSummary,
} from '../../../../source/shared/approval';
import { Button, Card, Coin, colors, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

export function ApprovalReview({
  summary,
  transaction,
  disabled,
  edit,
  onEditingChange,
  chainId,
  registrationHash,
}: {
  summary: ApprovalSummary;
  transaction: object;
  disabled: boolean;
  edit(value: string): Promise<void>;
  onEditingChange(editing: boolean): void;
  chainId?: string;
  registrationHash?: string;
}) {
  const { t } = useNativeTranslation();
  const [editor, setEditor] = useState<{
    transaction: object;
    value: string;
    error?: string;
  } | null>(null);
  const editing = editor?.transaction === transaction ? editor : null;
  const token = summary.token;
  const knownAmount =
    summary.standardVerified && summary.tokenStandard === 'ERC-20';
  let title = t('send.unverifiedApprovalRequest');
  let authority = t('send.approvalAuthority');
  if (summary.approvalType === 'nft-all') {
    authority = t('transactions.operator');
    title = t('mobile.dappConsent.approvalReview.operatorApprovalRequest');
    if (summary.standardVerified) {
      title = summary.isRevocation
        ? t('mobile.dappConsent.approvalReview.revokeNftOperator')
        : t('mobile.dappConsent.approvalReview.nftOperatorAccess');
    }
  } else if (summary.approvalType === 'erc721-single') {
    authority = t('blacklist.approvedDescription');
    title = summary.isRevocation ? t('mobile.dappConsent.approvalReview.revokeNftAccess') : t('mobile.dappConsent.approvalReview.nftAccess');
  } else if (knownAmount) {
    authority = t('transactions.spender');
    title = summary.isRevocation ? t('mobile.dappConsent.approvalReview.setAllowanceToZero') : t('mobile.dappConsent.approvalReview.tokenAllowance');
    if (summary.method === 'increaseAllowance')
      title = t('mobile.dappConsent.approvalReview.increaseTokenAllowance');
    else if (summary.method === 'decreaseAllowance')
      title = t('mobile.dappConsent.approvalReview.decreaseTokenAllowance');
  }

  let amountLabel = t('send.approvalRawValue');
  if (knownAmount) {
    amountLabel = t('mobile.dappConsent.approvalReview.spendingLimit');
    if (summary.method === 'increaseAllowance') amountLabel = t('mobile.dappConsent.approvalReview.increaseBy');
    else if (summary.method === 'decreaseAllowance')
      amountLabel = t('mobile.dappConsent.approvalReview.decreaseBy');
  }
  let amount = summary.amountUnits;
  if (summary.isUnlimited) amount = t('transactions.unlimited');
  else if (token && amount !== undefined) {
    amount = `${formatApprovalTokenAmount(amount, token.decimals)} ${
      token.symbol
    }`;
  }

  let operatorAction = t('mobile.dappConsent.approvalReview.removeOperatorAccess');
  if (summary.approved) {
    operatorAction = summary.standardVerified
      ? t('mobile.dappConsent.approvalReview.allowAccessToAllNftsInThis')
      : t('mobile.dappConsent.approvalReview.requestOperatorAccess');
  }
  const apply = () => {
    if (!editing || !token) return;
    if (parseApprovalAmount(editing.value, token.decimals) === null) {
      setEditor({
        ...editing,
        error: t('mobile.dappConsent.approvalReview.enterAnExactAmountOfZeroOr'),
      });
      return;
    }
    void edit(editing.value).catch(() => {
      setEditor((current) => {
        if (current?.transaction !== transaction) return current;
        return {
          ...current,
          error: t('mobile.dappConsent.approvalReview.theLimitCouldNotBeUpdatedTry'),
        };
      });
    });
  };
  return (
    <Card style={s.card}>
      <View style={s.heading}>
        {chainId && <Coin id="approval-token" asset={{ kind: 'evm', chainId, contractAddress: summary.tokenContract, decimals: token?.decimals }} registrationHash={registrationHash} fallbackSymbol={token?.symbol ?? 'NFT'} size={30} />}
        <Text accessibilityRole="header" style={s.title}>{title}</Text>
      </View>
      <Text style={s.label}>{authority}</Text>
      <Text selectable style={s.address}>
        {summary.authority}
      </Text>
      <Text style={s.label}>{t('assetTransfer.contract')}</Text>
      <Text selectable style={s.address}>
        {summary.tokenContract}
      </Text>
      {!summary.standardVerified && (
        <Text style={s.secondary}>{t('send.approvalStandardUnverified')}</Text>
      )}
      {summary.tokenId !== undefined && (
        <View style={s.field}>
          <Text style={s.label}>{t('send.tokenId')}</Text>
          <Text selectable style={s.value}>
            {summary.tokenId}
          </Text>
        </View>
      )}
      {summary.amountUnits !== undefined && (
        <View style={s.field}>
          <Text style={s.label}>{amountLabel}</Text>
          <Text
            selectable
            style={[s.value, summary.isUnlimited && s.unlimited]}
          >
            {amount}
          </Text>
        </View>
      )}
      {summary.approved !== undefined && (
        <Text style={s.value}>{operatorAction}</Text>
      )}
      {summary.canEditAmount && token && !editing && (
        <Button
          title={t('mobile.dappConsent.approvalReview.editSpendingLimit')}
          variant="secondary"
          disabled={disabled}
          onPress={() => {
            onEditingChange(true);
            setEditor({
              transaction,
              value: formatApprovalTokenAmount(
                summary.amountUnits!,
                token.decimals
              ),
            });
          }}
        />
      )}
      {editing && token && (
        <View style={s.field}>
          <Text style={s.label}>{t('mobile.dappConsent.approvalReview.newSpendingLimitSymbol', { symbol: token.symbol })}</Text>
          <IdleTextInput
            accessibilityLabel={t('mobile.dappConsent.approvalReview.newSpendingLimit')}
            keyboardType="decimal-pad"
            value={editing.value}
            onChangeText={(value) => setEditor({ transaction, value })}
            editable={!disabled}
            maxLength={334}
            autoCorrect={false}
            autoCapitalize="none"
            selectTextOnFocus
            style={s.input}
          />
          {editing.error && (
            <Text accessibilityRole="alert" style={s.error}>
              {editing.error}
            </Text>
          )}
          <Button title={t('mobile.dappConsent.approvalReview.applyLimit')} disabled={disabled} onPress={apply} />
          <Button
            title={t('mobile.dappConsent.approvalReview.keepCurrentLimit')}
            variant="secondary"
            disabled={disabled}
            onPress={() => {
              onEditingChange(false);
              setEditor(null);
            }}
          />
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  card: { gap: 10, padding: 20 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 18, lineHeight: 25, fontWeight: '600', flexShrink: 1 },
  label: { fontSize: 12, lineHeight: 17, color: colors.muted },
  address: { fontSize: 13, lineHeight: 20, color: colors.muted },
  secondary: { fontSize: 14, lineHeight: 21, color: colors.muted },
  value: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  field: { gap: 8 },
  unlimited: { color: colors.amber },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    color: colors.text,
    fontSize: 16,
  },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
