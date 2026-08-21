import { useState, useEffect, useCallback } from 'react';
import type { Device } from '../models/Device';
import { deviceService } from '../services';

/**
 * useDevice — fetches a single device and subscribes to its status updates.
 */
export function useDevice(id: string) {
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const d = await deviceService.getDevice(id);
      setDevice(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load device');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const unsub = deviceService.subscribeToDevice(id, (updated) => {
      setDevice(updated);
    });
    return unsub;
  }, [id, refresh]);

  return { device, loading, error, refresh };
}
