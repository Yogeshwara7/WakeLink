import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { connectionService } from '../../src/services';
import { useDevice } from '../../src/store/useDevice';
import { ConnectionStep } from '../../src/models/ConnectionSession';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../src/theme';

// ── Ordered step config ───────────────────────────────────────────────────

interface StepConfig {
  step: ConnectionStep;
  label: string;
  /** Steps that are only shown on the offline path */
  offlineOnly?: boolean;
}

const ALL_STEPS: StepConfig[] = [
  { step: ConnectionStep.CHECKING,      label: 'Checking PC' },
  { step: ConnectionStep.PC_OFFLINE,    label: 'PC is offline',    offlineOnly: true },
  { step: ConnectionStep.SENDING_WAKE,  label: 'Sending wake request', offlineOnly: true },
  { step: ConnectionStep.WAITING_FOR_PC,label: 'Waiting for PC',   offlineOnly: true },
  { step: ConnectionStep.PC_ONLINE,     label: 'PC is online' },
  { step: ConnectionStep.CONNECTING,    label: 'Connecting' },
  { step: ConnectionStep.CONNECTED,     label: 'Connected' },
];

type Phase = 'running' | 'failed' | 'connected';

export default function ConnectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { device } = useDevice(id);

  const [currentStep, setCurrentStep] = useState<ConnectionStep>(ConnectionStep.CHECKING);
  const [message, setMessage] = useState('Starting…');
  const [phase, setPhase] = useState<Phase>('running');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Track which steps have been visited (for offline path visibility)
  const [visitedSteps, setVisitedSteps] = useState<Set<ConnectionStep>>(
    new Set([ConnectionStep.CHECKING]),
  );

  // Animated values per step row
  const rowAnims = useRef(
    ALL_STEPS.reduce<Record<string, Animated.Value>>((acc, s) => {
      acc[s.step] = new Animated.Value(0);
      return acc;
    }, {}),
  ).current;

  // Overall content fade-in
  const contentOpacity = useRef(new Animated.Value(0)).current;

  // Success scale
  const successScale = useRef(new Animated.Value(0.5)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  // Animate a step row into view
  const animateRow = useCallback(
    (step: ConnectionStep) => {
      Animated.spring(rowAnims[step], {
        toValue: 1,
        tension: 70,
        friction: 10,
        useNativeDriver: true,
      }).start();
    },
    [rowAnims],
  );

  // Run the connection state machine
  useEffect(() => {
    let cancelled = false;

    connectionService
      .connect(id, (step, msg) => {
        if (cancelled) return;
        setCurrentStep(step);
        setMessage(msg);
        setVisitedSteps((prev) => new Set([...prev, step]));
        animateRow(step);
      })
      .then(() => {
        if (cancelled) return;
        setPhase('connected');
        // Animate success indicator
        Animated.parallel([
          Animated.spring(successScale, {
            toValue: 1,
            tension: 60,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(successOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Short pause then navigate to session screen
          setTimeout(() => {
            if (!cancelled) {
              router.replace(`/session/${id}`);
            }
          }, 800);
        });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPhase('failed');
        setErrorMessage(err.message ?? 'Connection failed');
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleCancel = useCallback(() => {
    Alert.alert('Cancel connection?', 'The connection attempt will be stopped.', [
      { text: 'Keep trying', style: 'cancel' },
      {
        text: 'Cancel',
        style: 'destructive',
        onPress: () => {
          connectionService.disconnect(id).catch(() => {});
          router.back();
        },
      },
    ]);
  }, [id]);

  const handleRetry = useCallback(() => {
    router.replace(`/connect/${id}`);
  }, [id]);

  // Decide which steps to show — only show offline steps if visited
  const visibleSteps = ALL_STEPS.filter(
    (s) => !s.offlineOnly || visitedSteps.has(s.step),
  );

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.content, { opacity: contentOpacity }]}>

        {/* Device name */}
        <Text style={styles.deviceName}>{device?.name ?? 'PC'}</Text>

        {/* Current message */}
        <Text style={styles.message} numberOfLines={2}>
          {phase === 'failed' ? errorMessage : message}
        </Text>

        {/* ── State machine steps ─────────────────────────────────────── */}
        <View style={styles.stepsWrap}>
          {visibleSteps.map((cfg, idx) => {
            const state = stepState(cfg.step, currentStep, visitedSteps, phase);
            return (
              <React.Fragment key={cfg.step}>
                <StepRow
                  label={cfg.label}
                  state={state}
                  anim={rowAnims[cfg.step]}
                  isCurrent={cfg.step === currentStep && phase === 'running'}
                />
                {idx < visibleSteps.length - 1 && (
                  <StepConnector active={state === 'done'} />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {/* ── Success overlay ──────────────────────────────────────────── */}
        {phase === 'connected' && (
          <Animated.View
            style={[
              styles.successBadge,
              { transform: [{ scale: successScale }], opacity: successOpacity },
            ]}
          >
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.successText}>Connected</Text>
          </Animated.View>
        )}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        {phase === 'failed' && (
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={handleRetry}
              activeOpacity={0.8}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="Retry connection"
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.back()}
              activeOpacity={0.7}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text style={styles.backText}>Go back</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'running' && (
          <TouchableOpacity
            onPress={handleCancel}
            activeOpacity={0.7}
            style={styles.cancelBtn}
            accessibilityRole="button"
            accessibilityLabel="Cancel connection"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </View>
  );
}

// ── Step state helper ─────────────────────────────────────────────────────

type RowState = 'pending' | 'active' | 'done' | 'failed';

function stepState(
  step: ConnectionStep,
  current: ConnectionStep,
  visited: Set<ConnectionStep>,
  phase: Phase,
): RowState {
  if (phase === 'failed' && step === current) return 'failed';
  if (visited.has(step) && step !== current) return 'done';
  if (step === current) return 'active';
  return 'pending';
}

// ── Sub-components ────────────────────────────────────────────────────────

function StepRow({
  label,
  state,
  anim,
  isCurrent,
}: {
  label: string;
  state: RowState;
  anim: Animated.Value;
  isCurrent: boolean;
}) {
  // Pulse animation for active state
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isCurrent) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,   duration: 600, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => { loop.stop(); pulseAnim.setValue(1); };
    }
  }, [isCurrent, pulseAnim]);

  const dotColor = {
    pending:  Colors.bgElevated,
    active:   Colors.brand,
    done:     Colors.online,
    failed:   Colors.danger,
  }[state];

  const textColor = {
    pending:  Colors.textMuted,
    active:   Colors.textPrimary,
    done:     Colors.textSecondary,
    failed:   Colors.danger,
  }[state];

  const icon = state === 'done' ? '✓' : state === 'failed' ? '✕' : '';

  return (
    <Animated.View
      style={[
        row_styles.row,
        {
          opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
          transform: [
            {
              translateX: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-16, 0],
              }),
            },
          ],
        },
      ]}
    >
      {/* Dot */}
      <Animated.View
        style={[
          row_styles.dot,
          { backgroundColor: dotColor },
          isCurrent && { opacity: pulseAnim },
        ]}
      >
        {icon ? (
          <Text style={[row_styles.dotIcon, state === 'failed' && { color: Colors.danger }]}>
            {icon}
          </Text>
        ) : null}
      </Animated.View>

      {/* Label */}
      <Text style={[row_styles.label, { color: textColor }]}>{label}</Text>

      {/* Active spinner dots */}
      {isCurrent && <ActiveIndicator />}
    </Animated.View>
  );
}

function ActiveIndicator() {
  // Three named refs — hooks must not be called inside array literals
  const dot0 = useRef(new Animated.Value(0.3)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dots = [dot0, dot1, dot2];

  useEffect(() => {
    const animations = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(d, { toValue: 1,   duration: 300, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay((dots.length - i) * 150),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  // dots is stable — values are refs, array reconstructed each render but values same
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={row_styles.dotsWrap}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={[row_styles.activeDot, { opacity: d }]}
        />
      ))}
    </View>
  );
}

function StepConnector({ active }: { active: boolean }) {
  return (
    <View style={[connector_styles.line, active && connector_styles.lineActive]} />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxl,
    alignItems: 'center',
  },
  deviceName: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  message: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    minHeight: FontSize.md * 2.5,
    marginBottom: Spacing.xl,
  },
  stepsWrap: {
    alignSelf: 'stretch',
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.online + '20',
    borderWidth: 1,
    borderColor: Colors.online,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full,
    marginBottom: Spacing.lg,
  },
  successIcon: {
    fontSize: FontSize.lg,
    color: Colors.online,
  },
  successText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.online,
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.sm,
  },
  retryBtn: {
    backgroundColor: Colors.brand,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  retryText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  backBtn: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  backText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  cancelBtn: {
    marginTop: 'auto' as any,
    paddingVertical: Spacing.sm,
  },
  cancelText: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
  },
});

const row_styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    gap: Spacing.md,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotIcon: {
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Colors.textInverse,
  },
  label: {
    flex: 1,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
  },
  dotsWrap: {
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.brand,
  },
});

const connector_styles = StyleSheet.create({
  line: {
    width: 2,
    height: 14,
    marginLeft: 10, // align with dot centre (dot width 22 / 2 - line width 2 / 2)
    backgroundColor: Colors.border,
    borderRadius: 1,
  },
  lineActive: {
    backgroundColor: Colors.online,
  },
});
