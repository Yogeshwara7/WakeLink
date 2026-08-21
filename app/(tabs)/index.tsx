import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useDevices } from '../../src/store/useDevices';
import { DeviceCard } from '../../src/components/DeviceCard';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import type { Device } from '../../src/models/Device';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../src/theme';

export default function HomeScreen() {
  const { devices, loading, error, refresh } = useDevices();
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const handleConnect = useCallback((device: Device) => {
    router.push(`/connect/${device.id}`);
  }, []);

  const handleDevicePress = useCallback((device: Device) => {
    router.push(`/device/${device.id}`);
  }, []);

  const handleAddDevice = useCallback(() => {
    router.push('/pair');
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.brand} />
        <Text style={styles.loadingText}>Loading your PCs…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <TouchableOpacity onPress={refresh} style={styles.retryBtn}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>WakeLink</Text>
          <Text style={styles.subtitle}>
            {devices.length === 0
              ? 'No PCs paired yet'
              : `${devices.length} PC${devices.length !== 1 ? 's' : ''} registered`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleAddDevice}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Pair a new PC"
          style={styles.addBtn}
        >
          <Text style={styles.addBtnText}>+ Add PC</Text>
        </TouchableOpacity>
      </View>

      {devices.length === 0 ? (
        /* Empty state */
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Text style={styles.emptyIconText}>💻</Text>
          </View>
          <Text style={styles.emptyTitle}>No PCs paired</Text>
          <Text style={styles.emptyBody}>
            Pair your Windows PC once and access it from anywhere.
          </Text>
          <TouchableOpacity
            onPress={handleAddDevice}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Pair your first PC"
            style={styles.emptyBtn}
          >
            <Text style={styles.emptyBtnText}>Pair my first PC</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DeviceCard
              device={item}
              onConnect={handleConnect}
              onPress={handleDevicePress}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.brand}
              colors={[Colors.brand]}
            />
          }
          ListFooterComponent={
            <TouchableOpacity
              onPress={handleAddDevice}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Pair another PC"
              style={styles.footerAddBtn}
            >
              <Text style={styles.footerAddText}>＋ Pair another PC</Text>
            </TouchableOpacity>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  errorTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryText: {
    fontSize: FontSize.md,
    color: Colors.brand,
    fontWeight: FontWeight.medium,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  greeting: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  addBtn: {
    backgroundColor: Colors.brand,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
  },
  addBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },

  // List
  listContent: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xxl,
  },

  // Footer
  footerAddBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },
  footerAddText: {
    fontSize: FontSize.md,
    color: Colors.brand,
    fontWeight: FontWeight.medium,
  },

  // Empty state
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: Radius.lg,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyIconText: {
    fontSize: 36,
  },
  emptyTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  emptyBody: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: FontSize.md * 1.6,
  },
  emptyBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.brand,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBtnText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
});
