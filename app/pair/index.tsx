import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Keyboard,
  Alert,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { pairingService } from '../../src/services';
import type { PairingSession } from '../../src/models/PairingSession';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../src/theme';

// ── Pairing flow steps ────────────────────────────────────────────────────
type FlowStep = 'choose' | 'scan' | 'manual' | 'naming' | 'success';

export default function PairScreen() {
  const [step, setStep] = useState<FlowStep>('choose');
  const [session, setSession] = useState<PairingSession | null>(null);
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  // Fade transition between steps
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const transitionTo = useCallback(
    (nextStep: FlowStep, after?: () => void) => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setStep(nextStep);
        after?.();
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      });
    },
    [fadeAnim],
  );

  // ── Step: Choose method ──────────────────────────────────────────────────
  const handleChooseQR = useCallback(async () => {
    setLoading(true);
    try {
      const s = await pairingService.startPairing('qr');
      setSession(s);
      transitionTo('scan');
    } finally {
      setLoading(false);
    }
  }, [transitionTo]);

  const handleChooseManual = useCallback(async () => {
    setLoading(true);
    try {
      const s = await pairingService.startPairing('manual');
      setSession(s);
      setCode('');
      setCodeError(null);
      transitionTo('manual');
    } finally {
      setLoading(false);
    }
  }, [transitionTo]);

  // ── Step: Submit code (from scan or manual) ──────────────────────────────
  const handleSubmitCode = useCallback(
    async (submittedCode: string) => {
      if (!session) return;
      Keyboard.dismiss();
      setLoading(true);
      setCodeError(null);
      try {
        const result = await pairingService.submitCode(session, submittedCode);
        if (result.status === 'confirmed') {
          setSession(result);
          transitionTo('naming');
        } else {
          setCodeError(result.errorMessage ?? 'Invalid code. Please try again.');
        }
      } catch {
        setCodeError('Something went wrong. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [session, transitionTo],
  );

  // Simulate QR scan success after a short delay
  const handleMockScan = useCallback(async () => {
    setLoading(true);
    // In a real implementation this comes from the camera scanner callback
    await new Promise((r) => setTimeout(r, 1200));
    setLoading(false);
    await handleSubmitCode('ABC123');
  }, [handleSubmitCode]);

  // ── Step: Finalise with device name ─────────────────────────────────────
  const handleFinalise = useCallback(async () => {
    if (!session || !deviceName.trim()) return;
    setLoading(true);
    try {
      await pairingService.finalisePairing(session, deviceName.trim());
      transitionTo('success');
    } catch {
      Alert.alert('Error', 'Could not complete pairing. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [session, deviceName, transitionTo]);

  // ── Cancel / back ────────────────────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    if (session) {
      await pairingService.cancelPairing(session).catch(() => {});
    }
    router.back();
  }, [session]);

  const handleDone = useCallback(() => {
    router.replace('/(tabs)');
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <ScreenContainer>
      <Animated.View style={{ opacity: fadeAnim, flex: 1 }}>
        {step === 'choose' && (
          <ChooseMethodStep
            onQR={handleChooseQR}
            onManual={handleChooseManual}
            onCancel={handleCancel}
            loading={loading}
          />
        )}
        {step === 'scan' && (
          <ScanQRStep
            onMockScan={handleMockScan}
            onManual={() => transitionTo('manual')}
            onCancel={handleCancel}
            loading={loading}
          />
        )}
        {step === 'manual' && (
          <ManualCodeStep
            code={code}
            onCodeChange={(v) => {
              setCode(v.toUpperCase());
              setCodeError(null);
            }}
            onSubmit={() => handleSubmitCode(code)}
            error={codeError}
            loading={loading}
            onCancel={handleCancel}
          />
        )}
        {step === 'naming' && (
          <NamingStep
            deviceName={deviceName}
            onNameChange={setDeviceName}
            onConfirm={handleFinalise}
            loading={loading}
          />
        )}
        {step === 'success' && (
          <SuccessStep deviceName={deviceName} onDone={handleDone} />
        )}
      </Animated.View>
    </ScreenContainer>
  );
}

// ── Step components ──────────────────────────────────────────────────────────

function ChooseMethodStep({
  onQR,
  onManual,
  onCancel,
  loading,
}: {
  onQR: () => void;
  onManual: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <View style={step_styles.container}>
      <StepHeader
        icon="🖥️"
        title="Pair a PC"
        body="Install the WakeLink Agent on your Windows PC, then pair it with your phone. You only need to do this once."
      />

      <View style={step_styles.methods}>
        <MethodCard
          icon="📷"
          title="Scan QR Code"
          description="Point your camera at the QR code shown by the WakeLink Agent"
          onPress={onQR}
          disabled={loading}
          recommended
        />
        <MethodCard
          icon="⌨️"
          title="Enter code manually"
          description="Type the 6-character code shown by the WakeLink Agent"
          onPress={onManual}
          disabled={loading}
        />
      </View>

      {loading && (
        <ActivityIndicator color={Colors.brand} style={{ marginTop: Spacing.md }} />
      )}

      <Button
        label="Cancel"
        onPress={onCancel}
        variant="ghost"
        style={step_styles.cancelBtn}
      />
    </View>
  );
}

function ScanQRStep({
  onMockScan,
  onManual,
  onCancel,
  loading,
}: {
  onMockScan: () => void;
  onManual: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <View style={step_styles.container}>
      <StepHeader
        icon="📷"
        title="Scan QR Code"
        body="Hold your camera over the QR code displayed by the WakeLink Agent on your PC."
      />

      {/* Mock camera viewfinder */}
      <View style={scan_styles.viewfinder}>
        <View style={scan_styles.corner_tl} />
        <View style={scan_styles.corner_tr} />
        <View style={scan_styles.corner_bl} />
        <View style={scan_styles.corner_br} />

        {loading ? (
          <View style={scan_styles.scanningOverlay}>
            <ActivityIndicator size="large" color={Colors.brand} />
            <Text style={scan_styles.scanningText}>Reading code…</Text>
          </View>
        ) : (
          <Text style={scan_styles.placeholder}>Camera preview</Text>
        )}
      </View>

      <Text style={scan_styles.hint}>
        The QR code is displayed in the WakeLink Agent window on your PC.
      </Text>

      {/* In a real build this button is hidden — shown here for demo */}
      {!loading && (
        <Button
          label="Simulate scan (demo)"
          onPress={onMockScan}
          variant="secondary"
          style={step_styles.actionBtn}
        />
      )}

      <Button
        label="Enter code manually instead"
        onPress={onManual}
        variant="ghost"
        disabled={loading}
        style={step_styles.actionBtn}
      />
      <Button
        label="Cancel"
        onPress={onCancel}
        variant="ghost"
        disabled={loading}
        style={step_styles.cancelBtn}
      />
    </View>
  );
}

function ManualCodeStep({
  code,
  onCodeChange,
  onSubmit,
  error,
  loading,
  onCancel,
}: {
  code: string;
  onCodeChange: (v: string) => void;
  onSubmit: () => void;
  error: string | null;
  loading: boolean;
  onCancel: () => void;
}) {
  return (
    <View style={step_styles.container}>
      <StepHeader
        icon="⌨️"
        title="Enter pairing code"
        body="Type the 6-character code shown by the WakeLink Agent on your PC. Codes are case-insensitive."
      />

      <Card style={code_styles.card}>
        <TextInput
          value={code}
          onChangeText={onCodeChange}
          style={[code_styles.input, error ? code_styles.inputError : null]}
          placeholder="A B C 1 2 3"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          keyboardType="default"
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          editable={!loading}
          accessibilityLabel="Pairing code input"
          accessibilityHint="Enter the 6-character code shown on your PC"
        />
        {error && <Text style={code_styles.errorText}>{error}</Text>}

        <Text style={code_styles.hint}>
          Open the WakeLink Agent on your PC to see your pairing code.
        </Text>
      </Card>

      <Button
        label={loading ? 'Verifying…' : 'Confirm'}
        onPress={onSubmit}
        loading={loading}
        disabled={code.length < 6}
        style={step_styles.actionBtn}
        accessibilityLabel="Confirm pairing code"
      />
      <Button
        label="Cancel"
        onPress={onCancel}
        variant="ghost"
        disabled={loading}
        style={step_styles.cancelBtn}
      />
    </View>
  );
}

function NamingStep({
  deviceName,
  onNameChange,
  onConfirm,
  loading,
}: {
  deviceName: string;
  onNameChange: (v: string) => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <View style={step_styles.container}>
      <StepHeader
        icon="✅"
        title="PC verified!"
        body="Give your PC a friendly name so you can recognise it later."
      />

      <Card style={code_styles.card}>
        <Text style={naming_styles.label}>PC name</Text>
        <TextInput
          value={deviceName}
          onChangeText={onNameChange}
          style={code_styles.input}
          placeholder="e.g. Home Laptop"
          placeholderTextColor={Colors.textMuted}
          autoFocus
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={onConfirm}
          editable={!loading}
          accessibilityLabel="PC name input"
        />
        <Text style={code_styles.hint}>
          You can rename it later from the device settings.
        </Text>
      </Card>

      <Button
        label={loading ? 'Saving…' : 'Add PC'}
        onPress={onConfirm}
        loading={loading}
        disabled={!deviceName.trim()}
        style={step_styles.actionBtn}
        accessibilityLabel="Finish pairing and add PC"
      />
    </View>
  );
}

function SuccessStep({
  deviceName,
  onDone,
}: {
  deviceName: string;
  onDone: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 70,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <View style={success_styles.container}>
      <Animated.View
        style={[
          success_styles.iconWrap,
          { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
        ]}
      >
        <Text style={success_styles.icon}>✓</Text>
      </Animated.View>

      <Animated.View style={{ opacity: opacityAnim, alignItems: 'center' }}>
        <Text style={success_styles.title}>
          {deviceName || 'Your PC'} is paired!
        </Text>
        <Text style={success_styles.body}>
          Your PC is now registered. You can connect to it from the home screen any time.
        </Text>
      </Animated.View>

      <Button
        label="Go to My PCs"
        onPress={onDone}
        style={step_styles.actionBtn}
      />
    </View>
  );
}

// ── Reusable sub-components ───────────────────────────────────────────────

function StepHeader({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <View style={header_styles.wrap}>
      <Text style={header_styles.icon}>{icon}</Text>
      <Text style={header_styles.title}>{title}</Text>
      <Text style={header_styles.body}>{body}</Text>
    </View>
  );
}

function MethodCard({
  icon,
  title,
  description,
  onPress,
  disabled,
  recommended,
}: {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
  recommended?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[method_styles.card, disabled && method_styles.disabled]}
    >
      <Text style={method_styles.icon}>{icon}</Text>
      <View style={method_styles.text}>
        <View style={method_styles.titleRow}>
          <Text style={method_styles.title}>{title}</Text>
          {recommended && (
            <View style={method_styles.badge}>
              <Text style={method_styles.badgeText}>Recommended</Text>
            </View>
          )}
        </View>
        <Text style={method_styles.description}>{description}</Text>
      </View>
      <Text style={method_styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const step_styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Spacing.sm,
  },
  methods: {
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  actionBtn: {
    marginTop: Spacing.md,
  },
  cancelBtn: {
    marginTop: Spacing.xs,
  },
});

const header_styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  icon: {
    fontSize: 48,
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: FontSize.md * 1.6,
    paddingHorizontal: Spacing.sm,
  },
});

const method_styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  disabled: {
    opacity: 0.4,
  },
  icon: {
    fontSize: 28,
    width: 40,
    textAlign: 'center',
  },
  text: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  description: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: FontSize.sm * 1.5,
  },
  badge: {
    backgroundColor: Colors.brand + '25',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  badgeText: {
    fontSize: FontSize.xs,
    color: Colors.brand,
    fontWeight: FontWeight.semibold,
  },
  chevron: {
    fontSize: 22,
    color: Colors.textMuted,
  },
});

const scan_styles = StyleSheet.create({
  viewfinder: {
    height: 260,
    marginVertical: Spacing.lg,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  placeholder: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  scanningOverlay: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  scanningText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  hint: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: FontSize.sm * 1.5,
    marginBottom: Spacing.sm,
  },
  // Corner brackets
  corner_tl: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: Colors.brand,
    borderTopLeftRadius: 4,
  },
  corner_tr: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: Colors.brand,
    borderTopRightRadius: 4,
  },
  corner_bl: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    width: 28,
    height: 28,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: Colors.brand,
    borderBottomLeftRadius: 4,
  },
  corner_br: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 28,
    height: 28,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: Colors.brand,
    borderBottomRightRadius: 4,
  },
});

const code_styles = StyleSheet.create({
  card: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.bgInput,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.xxl,
    color: Colors.textPrimary,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    letterSpacing: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  inputError: {
    borderColor: Colors.danger,
  },
  errorText: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    textAlign: 'center',
  },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: FontSize.xs * 1.6,
  },
});

const naming_styles = StyleSheet.create({
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});

const success_styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: Radius.full,
    backgroundColor: Colors.online + '20',
    borderWidth: 2,
    borderColor: Colors.online,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 40,
    color: Colors.online,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: FontSize.md * 1.6,
  },
});
