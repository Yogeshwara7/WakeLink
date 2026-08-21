import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  StatusBar,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { connectionService } from '../../src/services';
import { useDevice } from '../../src/store/useDevice';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../src/theme';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { device } = useDevice(id);

  const [controlsVisible, setControlsVisible] = useState(true);
  const [sessionDuration, setSessionDuration] = useState(0);

  // Overlay fade
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  // Entry animation
  const entryScale = useRef(new Animated.Value(0.95)).current;
  const entryOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(entryOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.spring(entryScale, {
        toValue: 1,
        tension: 80,
        friction: 10,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Session timer
  useEffect(() => {
    const interval = setInterval(() => {
      setSessionDuration((d) => d + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-hide controls after 4 seconds
  useEffect(() => {
    if (!controlsVisible) return;
    const timer = setTimeout(() => hideControls(), 4000);
    return () => clearTimeout(timer);
  }, [controlsVisible]);

  const hideControls = useCallback(() => {
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setControlsVisible(false));
  }, [overlayOpacity]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    overlayOpacity.setValue(1);
  }, [overlayOpacity]);

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      'Disconnect?',
      'This will end your remote session.',
      [
        { text: 'Stay connected', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await connectionService.disconnect(id).catch(() => {});
            router.replace('/(tabs)');
          },
        },
      ],
    );
  }, [id]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {/* ── Remote desktop canvas placeholder ─────────────────────────── */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={showControls}
        style={styles.canvas}
        accessibilityLabel="Remote session screen. Tap to show controls."
      >
        <Animated.View
          style={[
            styles.placeholderWrap,
            { opacity: entryOpacity, transform: [{ scale: entryScale }] },
          ]}
        >
          {/* Simulated desktop chrome */}
          <View style={styles.desktopChrome}>
            <View style={styles.taskbar}>
              <View style={styles.taskbarStart}>
                <View style={styles.taskbarBtn} />
                <View style={styles.taskbarSearch} />
              </View>
              <Text style={styles.taskbarClock}>
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>

            <View style={styles.desktopArea}>
              <Text style={styles.placeholderLabel}>Remote Desktop</Text>
              <Text style={styles.placeholderSub}>
                {device?.name ?? 'PC'}
              </Text>
              <View style={styles.placeholderDivider} />
              <Text style={styles.placeholderNote}>
                Remote rendering will appear here once the{'\n'}
                WakeLink PC Agent and streaming stack are connected.
              </Text>
            </View>
          </View>
        </Animated.View>
      </TouchableOpacity>

      {/* ── Control overlay ────────────────────────────────────────────── */}
      {controlsVisible && (
        <Animated.View
          style={[styles.overlay, { opacity: overlayOpacity }]}
          pointerEvents="box-none"
        >
          {/* Top bar */}
          <View style={styles.topBar}>
            <View style={styles.topBarLeft}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadge}>LIVE</Text>
              <Text style={styles.sessionTimer}>{formatDuration(sessionDuration)}</Text>
            </View>

            <Text style={styles.deviceNameLabel} numberOfLines={1}>
              {device?.name ?? 'PC'}
            </Text>

            <TouchableOpacity
              onPress={handleDisconnect}
              activeOpacity={0.8}
              style={styles.disconnectBtn}
              accessibilityRole="button"
              accessibilityLabel="Disconnect from remote session"
            >
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom bar — future toolbar */}
          <View style={styles.bottomBar}>
            <ToolbarButton icon="⌨️" label="Keyboard" onPress={() => {}} />
            <ToolbarButton icon="🖱️" label="Mouse" onPress={() => {}} />
            <ToolbarButton icon="📋" label="Clipboard" onPress={() => {}} />
            <ToolbarButton icon="⚙️" label="Settings" onPress={() => {}} />
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function ToolbarButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={toolbar_styles.btn}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={toolbar_styles.icon}>{icon}</Text>
      <Text style={toolbar_styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  canvas: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  placeholderWrap: {
    flex: 1,
    padding: Spacing.xs,
  },
  desktopChrome: {
    flex: 1,
    backgroundColor: '#0f3460',
    borderRadius: Radius.sm,
    overflow: 'hidden',
    flexDirection: 'column-reverse', // taskbar at bottom like Windows
  },
  taskbar: {
    height: 40,
    backgroundColor: '#16213e',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
  },
  taskbarStart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  taskbarBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
  },
  taskbarSearch: {
    width: 120,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  taskbarClock: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.7)',
  },
  desktopArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  placeholderLabel: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
  },
  placeholderSub: {
    fontSize: FontSize.lg,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  placeholderDivider: {
    width: 40,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: Spacing.sm,
  },
  placeholderNote: {
    fontSize: FontSize.sm,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    lineHeight: FontSize.sm * 1.6,
  },

  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    pointerEvents: 'box-none' as any,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? 50 : Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.danger,
  },
  liveBadge: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.danger,
    letterSpacing: 0.8,
  },
  sessionTimer: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginLeft: 4,
  },
  deviceNameLabel: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  disconnectBtn: {
    backgroundColor: Colors.danger,
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
  },
  disconnectText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingVertical: Spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 28 : Spacing.sm,
  },
});

const toolbar_styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.md,
  },
  icon: {
    fontSize: 22,
  },
  label: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
});
