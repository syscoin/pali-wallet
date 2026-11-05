import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  type KeyDownEvent,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  capacityBudget,
  PRIVATE_VAULT_CAPACITIES,
} from '../../../../source/wallet/privateVaultEnvelope';
import type {
  IPrivateVaultCapacity,
  PrivateVaultCapacity,
} from '../../../../source/utils/privacy/privateVaultTypes';
import type { NativeNoteCapacityRuntime } from '../custody/noteBackupRuntime';
import { recordIdleActivity } from '../platform/security';
import { Button, Card, colors, Header, Row, Screen, styles, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';

type Props = {
  openCapacity(assertCurrent: () => void): Promise<NativeNoteCapacityRuntime>;
  onBack(): void;
};

export function NativeNoteCapacity({ openCapacity, onBack }: Props) {
  const life = useRef({ open: false, revision: 0, pending: false });
  const latestBack = useRef(onBack);
  const options = useRef(
    new Map<PrivateVaultCapacity, React.ComponentRef<typeof IdlePressable>>()
  );
  const [data, setData] = useState<IPrivateVaultCapacity>();
  const [choice, setChoice] = useState<PrivateVaultCapacity>();
  const [pending, setPending] = useState<'loading' | 'saving' | null>(
    'loading'
  );
  const [feedback, setFeedback] = useState<
    'load' | 'save' | 'limit' | 'saved'
  >();

  useLayoutEffect(() => {
    latestBack.current = onBack;
  }, [onBack]);
  const invalidate = useCallback(() => {
    const owner = life.current;
    owner.open = false;
    owner.revision++;
    owner.pending = false;
  }, []);
  const back = useCallback(() => {
    invalidate();
    latestBack.current();
  }, [invalidate]);

  const readOrSave = useCallback(
    async (limit?: PrivateVaultCapacity) => {
      const owner = life.current;
      if (!owner.open || owner.pending || AppState.currentState !== 'active')
        return;
      const revision = ++owner.revision;
      owner.pending = true;
      setPending(limit === undefined ? 'loading' : 'saving');
      setFeedback(undefined);
      const isCurrent = () =>
        owner.open &&
        owner.revision === revision &&
        AppState.currentState === 'active';
      const assertCurrent = () => {
        if (!isCurrent()) throw new Error('CANCELLED');
      };
      try {
        const capacity = await openCapacity(assertCurrent);
        assertCurrent();
        const result = await (limit === undefined
          ? capacity.getCapacity()
          : capacity.setCapacity(limit));
        assertCurrent();
        setData(result);
        setChoice(result.capacity);
        if (limit !== undefined) setFeedback('saved');
      } catch (error) {
        if (!isCurrent()) return;
        if (
          limit !== undefined &&
          error instanceof Error &&
          error.message === 'privacy_note_limit'
        ) {
          setFeedback('limit');
        } else {
          // A save can commit before its result becomes unavailable.
          setData(undefined);
          setChoice(undefined);
          setFeedback(limit === undefined ? 'load' : 'save');
        }
      } finally {
        if (owner.revision === revision) {
          owner.pending = false;
          if (isCurrent()) setPending(null);
        }
      }
    },
    [openCapacity]
  );

  useLayoutEffect(() => {
    life.current.open = true;
    void readOrSave();
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        back();
        return true;
      }
    );
    return () => {
      invalidate();
      subscription.remove();
    };
  }, [back, invalidate, readOrSave]);

  const select = (limit: PrivateVaultCapacity) => {
    setChoice(limit);
    setFeedback(undefined);
  };
  const radioKeyboard = (event: KeyDownEvent, index: number) => {
    if (pending !== null) return;
    const { key } = event.nativeEvent;
    const count = PRIVATE_VAULT_CAPACITIES.length;
    let next = index;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (index + 1) % count;
    else if (key === 'ArrowLeft' || key === 'ArrowUp')
      next = (index + count - 1) % count;
    else if (key !== ' ') return;
    event.preventDefault();
    if (!recordIdleActivity()) return;
    const limit = PRIVATE_VAULT_CAPACITIES[next];
    if (limit === undefined) return;
    select(limit);
    options.current.get(limit)?.focus();
  };

  const message =
    feedback === 'load'
      ? 'Could not load the note limit.'
      : feedback === 'limit'
      ? 'The saved notes do not fit this limit.'
      : feedback === 'save'
      ? 'Could not confirm the new limit.'
      : feedback === 'saved'
      ? 'Note limit saved.'
      : null;
  const canSave = !!data && pending === null && choice !== undefined && choice !== data.capacity;
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
      <Screen
        footer={
          data && (
            <Button
              title={pending === 'saving' ? 'Saving limit…' : 'Save limit'}
              variant={canSave ? 'primary' : 'secondary'}
              disabled={!canSave}
              onPress={() => {
                if (choice !== undefined && choice !== data.capacity)
                  void readOrSave(choice);
              }}
            />
          )
        }
      >
        <Header title="Note capacity" onBack={back} />
        {pending === 'loading' && (
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            Checking note capacity…
          </Text>
        )}
        {data && (
          <>
            <Card>
              <Row
                title={`${data.noteCount} of ${data.capacity} notes saved`}
                subtitle={`${data.storedBytes.toLocaleString()} bytes used`}
                last
              />
            </Card>
            <Card
              accessibilityRole="radiogroup"
              accessibilityLabel="Note limit"
            >
              {PRIVATE_VAULT_CAPACITIES.map((limit, index) => {
                const checked = choice === limit;
                const size = capacityBudget(limit) / (1024 * 1024);
                const tabIndex: 0 | -1 = checked && pending === null ? 0 : -1;
                // RN Web's Pressable handles Enter but does not handle Space or arrows for radios.
                const keyboard =
                  Platform.OS === 'web'
                    ? {
                        tabIndex,
                        onKeyDown: (event: KeyDownEvent) =>
                          radioKeyboard(event, index),
                      }
                    : {};
                return (
                  <IdlePressable
                    key={limit}
                    ref={(option) => {
                      if (option) options.current.set(limit, option);
                      else options.current.delete(limit);
                    }}
                    {...keyboard}
                    accessibilityRole="radio"
                    accessibilityLabel={`${limit} notes, up to ${size} MiB`}
                    accessibilityState={{ checked, disabled: pending !== null }}
                    aria-checked={checked}
                    disabled={pending !== null}
                    onPress={() => select(limit)}
                    style={({ pressed }) => [
                      styles.row,
                      index < PRIVATE_VAULT_CAPACITIES.length - 1 &&
                        styles.rowBorder,
                      pressed && { backgroundColor: colors.raised },
                    ]}
                  >
                    <View style={s.option}>
                      <Text>{limit} notes</Text>
                      <Text style={styles.muted}>Up to {size} MiB</Text>
                    </View>
                    {checked && <Text style={s.check}>✓</Text>}
                  </IdlePressable>
                );
              })}
            </Card>
            <Text style={styles.muted}>
              Higher limits can use more local storage. Space grows as you save
              notes.
            </Text>
          </>
        )}
        {message && (
          <Text
            accessibilityRole={feedback === 'saved' ? undefined : 'alert'}
            accessibilityLiveRegion="polite"
            style={feedback === 'saved' ? styles.muted : s.error}
          >
            {message}
          </Text>
        )}
        {(feedback === 'load' || feedback === 'save') && (
          <Button
            title={feedback === 'save' ? 'Reload' : 'Retry'}
            variant="secondary"
            onPress={() => readOrSave()}
          />
        )}
      </Screen>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  option: { flex: 1, minWidth: 0, gap: 3 },
  check: { color: colors.blue },
  error: { color: colors.red },
});
