import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import type { Device } from '../models/Device';
import { DeviceStatus } from '../models/Device';
import { StatusDot } from './StatusDot';
import { Button } from './Button';
import {
  statusLabel,
  primaryActionLabel,
  canConnect,
  relativeTime,
} from '../utils/deviceStatus';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../theme';

interface Props {
  device: Device;
  onConnect: (device: Device) => void;
  onPress: (device: Device) => void;
}

export function DeviceCard({ device, onConnect, onPress }: Props) {
  const isActive =
    device.status === DeviceStatus.WAKING ||
    device.status === DeviceStatus.CONNECTING;

  // Subtle pulse animation for active states
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isActive) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isActive, pulseAnim]);

  const actionLabel = primaryActionLabel(device.status);
  const actionEnabled = canConnect(device.status);

  return (
    <TouchableOpacity
      onPress={() => onPress(device)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${device.name}, ${statusLabel(device.status)}. Tap for details.`}
      style={styles.card}
    >
      {/* Header row */}
      <View style={styles.header}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {device.name}
          </Text>
          <View style={styles.platformBadge}>
            <Text style={styles.platformText}>
              {device.platform === 'windows' ? 'WIN' : device.platform.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Status pill */}
        <View style={styles.statusRow}>
          <Animated.View style={{ opacity: isActive ? pulseAnim : 1 }}>
            <StatusDot status={device.status} size={8} />
          </Animated.View>
          <Text style={styles.statusText}>{statusLabel(device.status)}</Text>
        </View>
      </View>

      {/* Last seen */}
      <Text style={styles.lastSeen}>
        Last seen: {relativeTime(device.lastSeen)}
      </Text>

      {/* Capability badges */}
      <View style={styles.capRow}>
        {device.capabilities.wakeOnLan && (
          <View style={styles.capBadge}>
            <Text style={styles.capText}>Wake-on-LAN</Text>
          </View>
        )}
        {device.capabilities.hardwareWake && (
          <View style={styles.capBadge}>
            <Text style={styles.capText}>Hardware Wake</Text>
          </View>
        )}
        {device.capabilities.remoteDesktop && (
          <View style={styles.capBadge}>
            <Text style={styles.capText}>Remote Desktop</Text>
          </View>
        )}
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Primary action */}
      <Button
        label={actionLabel}
        onPress={() => onConnect(device)}
        variant={
          device.status === DeviceStatus.ONLINE ||
          device.status === DeviceStatus.CONNECTED
            ? 'primary'
            : 'secondary'
        }
        disabled={!actionEnabled}
        loading={isActive}
        style={styles.button}
        accessibilityLabel={`${actionLabel} ${device.name}`}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.xs,
  },
  nameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginRight: Spacing.sm,
  },
  name: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  platformBadge: {
    backgroundColor: Colors.bgElevated,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  platformText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  lastSeen: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  capRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  capBadge: {
    backgroundColor: Colors.bgElevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  capText: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  button: {
    width: '100%',
  },
});
