import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatApprovalTokenAmount, parseApprovalAmount, type ApprovalSummary } from '../../../../source/shared/approval';
import { Button, Card, colors, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

export function ApprovalReview({ summary, revision, disabled, edit }: {
  summary: ApprovalSummary;
  revision: number;
  disabled: boolean;
  edit(value: string): Promise<void>;
}) {
  const [editor, setEditor] = useState<{ revision: number; value: string; error?: string } | null>(null);
  const editing = editor?.revision === revision ? editor : null;
  const token = summary.token;
  const knownAmount = summary.standardVerified && summary.tokenStandard === 'ERC-20';
  const title = summary.approvalType === 'nft-all' ? !summary.standardVerified ? 'Operator approval request' : summary.isRevocation ? 'Revoke NFT operator' : 'NFT operator access'
    : summary.approvalType === 'erc721-single' ? summary.isRevocation ? 'Revoke NFT access' : 'NFT access'
    : !knownAmount ? 'Approval request' : summary.method === 'increaseAllowance' ? 'Increase token allowance'
    : summary.method === 'decreaseAllowance' ? 'Decrease token allowance' : summary.isRevocation ? 'Set allowance to zero' : 'Token allowance';
  const authority = summary.approvalType === 'nft-all' ? 'Operator' : summary.approvalType === 'erc721-single' ? 'Approved address' : knownAmount ? 'Spender' : 'Authority';
  const apply = () => {
    if (!editing || !token) return;
    if (parseApprovalAmount(editing.value, token.decimals) === null) {
      setEditor({ ...editing, error: 'Enter an exact amount of zero or more.' });
      return;
    }
    void edit(editing.value).catch(() => setEditor((current) =>
      current?.revision === revision ? { ...current, error: 'The limit could not be updated. Try again.' } : current));
  };
  return <Card style={s.card}>
    <Text accessibilityRole="header" style={s.title}>{title}</Text>
    <Text style={s.label}>{authority}</Text>
    <Text selectable style={s.address}>{summary.authority}</Text>
    <Text style={s.label}>Token contract</Text>
    <Text selectable style={s.address}>{summary.tokenContract}</Text>
    {!summary.standardVerified && <Text style={s.secondary}>Contract standard is unverified.</Text>}
    {summary.tokenId !== undefined && <View style={s.field}>
      <Text style={s.label}>Token ID</Text><Text selectable style={s.value}>{summary.tokenId}</Text>
    </View>}
    {summary.amountUnits !== undefined && <View style={s.field}>
      <Text style={s.label}>{knownAmount ? summary.method === 'increaseAllowance' ? 'Increase by' : summary.method === 'decreaseAllowance' ? 'Decrease by' : 'Spending limit' : 'Approval value (raw)'}</Text>
      <Text selectable style={[s.value, summary.isUnlimited && s.unlimited]}>{summary.isUnlimited ? 'Unlimited' : token
        ? `${formatApprovalTokenAmount(summary.amountUnits, token.decimals)} ${token.symbol}` : summary.amountUnits}</Text>
    </View>}
    {summary.approved !== undefined && <Text style={s.value}>{summary.approved
      ? summary.standardVerified ? 'Allow access to all NFTs in this contract' : 'Request operator access'
      : 'Remove operator access'}</Text>}
    {summary.canEditAmount && token && !editing && <Button title="Edit spending limit" variant="quiet" disabled={disabled}
      onPress={() => setEditor({ revision, value: formatApprovalTokenAmount(summary.amountUnits!, token.decimals) })} />}
    {editing && token && <View style={s.field}>
      <Text style={s.label}>New spending limit ({token.symbol})</Text>
      <IdleTextInput accessibilityLabel="New spending limit" keyboardType="decimal-pad" value={editing.value}
        onChangeText={(value) => setEditor({ revision, value })} editable={!disabled} maxLength={334}
        autoCorrect={false} autoCapitalize="none" selectTextOnFocus style={s.input} />
      {editing.error && <Text accessibilityRole="alert" style={s.error}>{editing.error}</Text>}
      <Button title="Apply limit" disabled={disabled} onPress={apply} />
      <Button title="Keep current limit" variant="quiet" disabled={disabled} onPress={() => setEditor(null)} />
    </View>}
  </Card>;
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
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, color: colors.text, fontSize: 16 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
