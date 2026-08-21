/**
 * The ordered states of a connection attempt.
 * The ConnectionService drives transitions through this sequence.
 */
export enum ConnectionStep {
  CHECKING = 'CHECKING',
  PC_OFFLINE = 'PC_OFFLINE',
  SENDING_WAKE = 'SENDING_WAKE',
  WAITING_FOR_PC = 'WAITING_FOR_PC',
  PC_ONLINE = 'PC_ONLINE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  FAILED = 'FAILED',
}

export interface ConnectionSession {
  deviceId: string;
  step: ConnectionStep;
  /** Human-readable description of the current step shown in the UI. */
  message: string;
  startedAt: string;
  errorMessage?: string;
}
