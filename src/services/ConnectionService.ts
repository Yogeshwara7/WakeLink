import type { ConnectionSession, ConnectionStep } from '../models/ConnectionSession';

/**
 * ConnectionService — orchestrates the full connect workflow.
 *
 * The service owns the state machine:
 *   CHECKING → (if offline) PC_OFFLINE → SENDING_WAKE → WAITING_FOR_PC
 *   → PC_ONLINE → CONNECTING → CONNECTED
 *
 *   CHECKING → (if online) PC_ONLINE → CONNECTING → CONNECTED
 *
 * Concrete implementations:
 *   MockConnectionService — simulates the sequence with delays.
 *   RealConnectionService — uses WakeService + actual RDP/streaming stack.
 */
export interface ConnectionService {
  /**
   * Starts a connection attempt.
   * Fires `onStepChange` for every state transition.
   * Resolves when CONNECTED; rejects on FAILED.
   */
  connect(
    deviceId: string,
    onStepChange: (step: ConnectionStep, message: string) => void,
  ): Promise<ConnectionSession>;

  /** Gracefully terminates an active session. */
  disconnect(deviceId: string): Promise<void>;
}
