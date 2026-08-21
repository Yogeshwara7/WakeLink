import { useState, useEffect, useCallback } from 'react';
import type { Device } from '../models/Device';
import { deviceService } from '../services';

/**
 * useDevices — fetches and keeps the device list fresh.
 *
 * Subscribes to status changes for each device so the home screen
 * reflects live updates without polling.
 */
export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const list = await deviceService.getDevices();
      setDevices(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // Subscribe to per-device live updates
  useEffect(() => {
    const unsubs = devices.map((d) =>
      deviceService.subscribeToDevice(d.id, (updated) => {
        setDevices((prev) =>
          prev.map((x) => (x.id === updated.id ? updated : x)),
        );
      }),
    );
    return () => unsubs.forEach((fn) => fn());
  }, [devices.length]); // re-subscribe when list length changes

  return { devices, loading, error, refresh };
}
