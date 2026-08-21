import { DeviceStatus } from '../models/Device';
import { Colors } from '../theme';

/** Returns the accent colour for a given status. */
export function statusColor(status: DeviceStatus): string {
  switch (status) {
    case DeviceStatus.ONLINE:     return Colors.online;
    case DeviceStatus.CONNECTED:  return Colors.connected;
    case DeviceStatus.WAKING:     return Colors.waking;
    case DeviceStatus.CONNECTING: return Colors.connecting;
    case DeviceStatus.OFFLINE:    return Colors.offline;
    default:                      return Colors.unknown;
  }
}

/** Returns the user-facing label for a status. */
export function statusLabel(status: DeviceStatus): string {
  switch (status) {
    case DeviceStatus.ONLINE:     return 'Online';
    case DeviceStatus.CONNECTED:  return 'Connected';
    case DeviceStatus.WAKING:     return 'Waking…';
    case DeviceStatus.CONNECTING: return 'Connecting…';
    case DeviceStatus.OFFLINE:    return 'Offline';
    default:                      return 'Unknown';
  }
}

/** Returns the primary action label for a device card. */
export function primaryActionLabel(status: DeviceStatus): string {
  switch (status) {
    case DeviceStatus.ONLINE:     return 'Connect';
    case DeviceStatus.CONNECTED:  return 'Resume';
    case DeviceStatus.WAKING:
    case DeviceStatus.CONNECTING: return 'Connecting…';
    case DeviceStatus.OFFLINE:    return 'Wake & Connect';
    default:                      return 'Connect';
  }
}

/** Whether the primary action button should be enabled. */
export function canConnect(status: DeviceStatus): boolean {
  return status === DeviceStatus.ONLINE
    || status === DeviceStatus.OFFLINE
    || status === DeviceStatus.CONNECTED;
}

/** Human-readable relative time. */
export function relativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (diff < 60_000)       return 'Just now';
  if (mins  < 60)          return `${mins}m ago`;
  if (hours < 24)          return `${hours}h ago`;
  return `${days}d ago`;
}
