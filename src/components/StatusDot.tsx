import React from 'react';
import { View, StyleSheet } from 'react-native';
import { DeviceStatus } from '../models/Device';
import { statusColor } from '../utils/deviceStatus';

interface Props {
  status: DeviceStatus;
  size?: number;
}

export function StatusDot({ status, size = 10 }: Props) {
  const color = statusColor(status);
  const pulse =
    status === DeviceStatus.WAKING || status === DeviceStatus.CONNECTING;

  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        pulse && { opacity: 0.9 },
      ]}
      accessibilityLabel={`Status: ${status}`}
    />
  );
}

const styles = StyleSheet.create({
  dot: {},
});
