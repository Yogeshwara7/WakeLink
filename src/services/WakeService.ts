/**
 * WakeService — responsible for triggering a wake request for an offline PC.
 *
 * Current implementations:
 *   MockWakeService — simulates a timed wake sequence.
 *
 * Future implementations (plug in without touching UI):
 *   WoLWakeService    — sends a Wake-on-LAN magic packet via cloud relay.
 *   HardwareWakeService — communicates with the USB out-of-band controller.
 */
export interface WakeService {
  /**
   * Sends a wake request for the given device.
   * Resolves when the request has been dispatched (not when the PC is online).
   */
  sendWakeRequest(deviceId: string): Promise<void>;

  /**
   * Polls (or subscribes) until the PC comes online or the timeout elapses.
   * Calls `onStatusChange` at each meaningful step.
   *
   * @param deviceId       Target device.
   * @param onStatusChange Callback with a human-readable progress message.
   * @param timeoutMs      How long to wait before rejecting (default: 60 000).
   */
  waitForOnline(
    deviceId: string,
    onStatusChange: (message: string) => void,
    timeoutMs?: number,
  ): Promise<void>;
}
