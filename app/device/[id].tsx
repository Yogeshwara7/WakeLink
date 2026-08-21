import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router, useNavigation } from 'expo-router';
import { useLayoutEffect } from 'react';
import { useDevice } from '../../src/store/useDevice';
import { StatusDot } from '../../src/components/StatusDot';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { SectionHeader } from '../../src/components/SectionHeader';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { deviceService } from '../../src/services';
import { DeviceStatus } from '../../src/models/Device';
import {
  statusLabel,
  primaryActionLabel,
  canConnect,
  relativeTime,
  statusColor,
} from '../../src/utils/deviceStatus';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../src/theme';

export default function DeviceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { device, loading, error, refresh } = useDevice(id);

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Keep header title in sync with device name
  useLayoutEffect(() => {
    if (device) {
      navigation.setOptions({ title: device.name });
    }
  }, [device?.name, navigation]);

  const handleConnect = useCallback(() => {
    router.push(`/connect/${id}`);
  }, [id]);

  const handleRename = useCallback(() => {
    setNewName(device?.name ?? '');
    setRenaming(true);
  }, [device]);

  const handleSaveRename = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await deviceService.updateDevice(id, { name: trimmed });
      setRenaming(false);
    } catch {
      Alert.alert('Error', 'Could not rename device. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [id, newName]);

  const handleRemove = useCallback(() => {
    Alert.alert(
      'Remove PC',
      `Remove "${device?.name}" from your account?\n\nYou can pair it again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await deviceService.removeDevice(id);
              router.back();
            } catch {
              Alert.alert('Error', 'Could not remove device. Please try again.');
              setRemoving(false);
            }
          },
        },
      ],
    );
  }, [id, device]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error || !device) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Device not found</Text>
        <Text style={styles.errorBody}>{error ?? 'This device may have been removed.'}</Text>
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  const isActive =
    device.status === DeviceStatus.WAKING ||
    device.status === DeviceStatus.CONNECTING;

  const accentColor = statusColor(device.status);

  return (
    <>
      <ScreenContainer>
        {/* ── Hero status block ─────────────────────────────────────────── */}
        <Card style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={[styles.deviceIcon, { borderColor: accentColor + '60' }]}>
              <Text style={styles.deviceIconText}>💻</Text>
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.deviceName}>{device.name}</Text>
              <Text style={styles.platformText}>
                {device.platform.charAt(0).toUpperCase() + device.platform.slice(1)}
              </Text>
            </View>
          </View>

          {/* Status pill */}
          <View style={[styles.statusPill, { backgroundColor: accentColor + '20' }]}>
            <StatusDot status={device.status} size={9} />
            <Text style={[styles.statusPillText, { color: accentColor }]}>
              {statusLabel(device.status)}
            </Text>
            {isActive && (
              <ActivityIndicator size="small" color={accentColor} style={styles.statusSpinner} />
            )}
          </View>

          <Text style={styles.lastSeen}>
            Last seen: {relativeTime(device.lastSeen)}
          </Text>
        </Card>

        {/* ── Primary action ────────────────────────────────────────────── */}
        <Button
          label={primaryActionLabel(device.status)}
          onPress={handleConnect}
          disabled={!canConnect(device.status)}
          loading={isActive}
          style={styles.connectBtn}
          accessibilityLabel={`${primaryActionLabel(device.status)} ${device.name}`}
        />

        {/* ── Device info ───────────────────────────────────────────────── */}
        <SectionHeader title="Device Info" style={styles.sectionHeader} />
        <Card style={styles.infoCard}>
          <InfoRow label="Device ID" value={device.id} mono />
          <InfoDivider />
          <InfoRow label="Platform" value={device.platform} />
          <InfoDivider />
          <InfoRow label="Last seen" value={relativeTime(device.lastSeen)} />
        </Card>

        {/* ── Capabilities ──────────────────────────────────────────────── */}
        <SectionHeader title="Capabilities" style={styles.sectionHeader} />
        <Card style={styles.infoCard}>
          <CapabilityRow
            label="Wake-on-LAN"
            supported={device.capabilities.wakeOnLan}
            description="Wake PC over the network"
          />
          <InfoDivider />
          <CapabilityRow
            label="Hardware Wake"
            supported={device.capabilities.hardwareWake}
            description="USB out-of-band wake controller"
          />
          <InfoDivider />
          <CapabilityRow
            label="Remote Desktop"
            supported={device.capabilities.remoteDesktop}
            description="Full remote session support"
          />
        </Card>

        {/* ── Management ────────────────────────────────────────────────── */}
        <SectionHeader title="Manage" style={styles.sectionHeader} />
        <Card>
          <TouchableOpacity
            onPress={handleRename}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Rename this PC"
            style={styles.actionRow}
          >
            <Text style={styles.actionLabel}>Rename PC</Text>
            <Text style={styles.actionChevron}>›</Text>
          </TouchableOpacity>
          <InfoDivider />
          <TouchableOpacity
            onPress={handleRemove}
            disabled={removing}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Remove this PC from your account"
            style={styles.actionRow}
          >
            {removing ? (
              <ActivityIndicator size="small" color={Colors.danger} />
            ) : (
              <Text style={[styles.actionLabel, styles.dangerText]}>
                Remove PC
              </Text>
            )}
            {!removing && <Text style={[styles.actionChevron, styles.dangerText]}>›</Text>}
          </TouchableOpacity>
        </Card>
      </ScreenContainer>

      {/* ── Rename modal ─────────────────────────────────────────────────── */}
      <Modal
        visible={renaming}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Rename PC</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              style={styles.modalInput}
              placeholder="e.g. Home Laptop"
              placeholderTextColor={Colors.textMuted}
              autoFocus
              maxLength={40}
              returnKeyType="done"
              onSubmitEditing={handleSaveRename}
              accessibilityLabel="New device name"
            />
            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                onPress={() => setRenaming(false)}
                variant="ghost"
                style={styles.modalBtn}
              />
              <Button
                label="Save"
                onPress={handleSaveRename}
                loading={saving}
                disabled={!newName.trim()}
                style={styles.modalBtn}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.label}>{label}</Text>
      <Text
        style={[infoStyles.value, mono && infoStyles.mono]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
    </View>
  );
}

function CapabilityRow({
  label,
  supported,
  description,
}: {
  label: string;
  supported: boolean;
  description: string;
}) {
  return (
    <View style={infoStyles.row}>
      <View style={infoStyles.capLeft}>
        <Text style={infoStyles.label}>{label}</Text>
        <Text style={infoStyles.capDesc}>{description}</Text>
      </View>
      <View
        style={[
          infoStyles.capBadge,
          { backgroundColor: supported ? Colors.online + '20' : Colors.bgElevated },
        ]}
      >
        <Text
          style={[
            infoStyles.capBadgeText,
            { color: supported ? Colors.online : Colors.textMuted },
          ]}
        >
          {supported ? 'Supported' : 'Not supported'}
        </Text>
      </View>
    </View>
  );
}

function InfoDivider() {
  return <View style={infoStyles.divider} />;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  errorTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  errorBody: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // Hero
  heroCard: {
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  deviceIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceIconText: {
    fontSize: 28,
  },
  heroInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  platformText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  statusPillText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  statusSpinner: {
    marginLeft: 2,
  },
  lastSeen: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },

  // Connect button
  connectBtn: {
    marginBottom: Spacing.lg,
  },

  // Section headers
  sectionHeader: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },

  // Info card
  infoCard: {
    marginBottom: Spacing.md,
  },

  // Action rows
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm + 2,
  },
  actionLabel: {
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium,
  },
  actionChevron: {
    fontSize: 20,
    color: Colors.textMuted,
  },
  dangerText: {
    color: Colors.danger,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.bgCard,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  modalInput: {
    backgroundColor: Colors.bgInput,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  modalBtn: {
    flex: 1,
  },
});

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  label: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    flexShrink: 0,
  },
  value: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium,
    flex: 1,
    textAlign: 'right',
  },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  capLeft: {
    flex: 1,
    gap: 2,
  },
  capDesc: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  capBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  capBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
});

