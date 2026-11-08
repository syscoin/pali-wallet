import React, { useState } from 'react';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { StyleSheet, View } from 'react-native';
import {
  formatApprovalTokenAmount,
  parseApprovalAmount,
  type ApprovalSummary,
} from '../../../../source/shared/approval';
import { Button, Card, colors, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

export function ApprovalReview({
  summary,
  transaction,
  disabled,
  edit,
  onEditingChange,
}: {
  summary: ApprovalSummary;
  transaction: PreparedEvmTransaction;
  disabled: boolean;
  edit(value: string): Promise<void>;
  onEditingChange(editing: boolean): void;
}) {
  const [editor, setEditor] = useState<{
    transaction: PreparedEvmTransaction;
    value: string;
    error?: string;
  } | null>(null);
  const editing = editor?.transaction === transaction ? editor : null;
  const token = summary.token;
  const knownAmount =
    summary.standardVerified && summary.tokenStandard === 'ERC-20';
  let title = 'Approval request';
  let authority = 'Authority';
  if (summary.approvalType === 'nft-all') {
    authority = 'Operator';
    title = 'Operator approval request';
    if (summary.standardVerified) {
      title = summary.isRevocation
        ? 'Revoke NFT operator'
        : 'NFT operator access';
    }
  } else if (summary.approvalType === 'erc721-single') {
    authority = 'Approved address';
    title = summary.isRevocation ? 'Revoke NFT access' : 'NFT access';
  } else if (knownAmount) {
    authority = 'Spender';
    title = summary.isRevocation ? 'Set allowance to zero' : 'Token allowance';
    if (summary.method === 'increaseAllowance')
      title = 'Increase token allowance';
    else if (summary.method === 'decreaseAllowance')
      title = 'Decrease token allowance';
  }

  let amountLabel = 'Approval value (raw)';
  if (knownAmount) {
    amountLabel = 'Spending limit';
    if (summary.method === 'increaseAllowance') amountLabel = 'Increase by';
    else if (summary.method === 'decreaseAllowance')
      amountLabel = 'Decrease by';
  }
  let amount = summary.amountUnits;
  if (summary.isUnlimited) amount = 'Unlimited';
  else if (token && amount !== undefined) {
    amount = `${formatApprovalTokenAmount(amount, token.decimals)} ${
      token.symbol
    }`;
  }

  let operatorAction = 'Remove operator access';
  if (summary.approved) {
    operatorAction = summary.standardVerified
      ? 'Allow access to all NFTs in this contract'
      : 'Request operator access';
  }
  const apply = () => {
    if (!editing || !token) return;
    if (parseApprovalAmount(editing.value, token.decimals) === null) {
      setEditor({
        ...editing,
        error: 'Enter an exact amount of zero or more.',
      });
      return;
    }
    void edit(editing.value).catch(() => {
      setEditor((current) => {
        if (current?.transaction !== transaction) return current;
        return {
          ...current,
          error: 'The limit could not be updated. Try again.',
        };
      });
    });
  };
  return (
    <Card style={s.card}>
      <Text accessibilityRole="header" style={s.title}>
        {title}
      </Text>
      <Text style={s.label}>{authority}</Text>
      <Text selectable style={s.address}>
        {summary.authority}
      </Text>
      <Text style={s.label}>Token contract</Text>
      <Text selectable style={s.address}>
        {summary.tokenContract}
      </Text>
      {!summary.standardVerified && (
        <Text style={s.secondary}>Contract standard is unverified.</Text>
      )}
      {summary.tokenId !== undefined && (
        <View style={s.field}>
          <Text style={s.label}>Token ID</Text>
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
          title="Edit spending limit"
          variant="quiet"
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
          <Text style={s.label}>New spending limit ({token.symbol})</Text>
          <IdleTextInput
            accessibilityLabel="New spending limit"
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
          <Button title="Apply limit" disabled={disabled} onPress={apply} />
          <Button
            title="Keep current limit"
            variant="quiet"
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
  title: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
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
