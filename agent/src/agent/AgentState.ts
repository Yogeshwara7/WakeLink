/**
 * AgentState — the runtime state of the agent process.
 *
 * Distinct from DeviceIdentity (which is persistent) and PairingStatus
 * (which tracks the user-account association). AgentState tracks what
 * the running process is currently doing.
 */
export type AgentState =
  | 'INITIALISING'   // Starting up, loading identity
  | 'UNPAIRED'       // Identity exists but not paired with a user account
  | 'PAIRING'        // Pairing session is active, waiting for phone
  | 'CONNECTING'     // Connecting to backend
  | 'ONLINE'         // Connected to backend and sending heartbeats
  | 'RECONNECTING'   // Lost connection, attempting to reconnect
  | 'OFFLINE'        // Cannot reach backend
  | 'STOPPING'       // Graceful shutdown in progress
  | 'ERROR';         // Unrecoverable error

export type AgentStateChangeCallback = (
  previous: AgentState,
  next: AgentState,
) => void;

/**
 * AgentStateManager — observable state machine for the agent.
 *
 * All state transitions go through transition(), which validates the
 * change and notifies listeners. This makes the agent lifecycle easy
 * to follow in logs and tests.
 */
export class AgentStateManager {
  private state: AgentState = 'INITIALISING';
  private readonly listeners: AgentStateChangeCallback[] = [];

  get current(): AgentState {
    return this.state;
  }

  /** Valid transitions — prevents impossible state jumps. */
  private static readonly VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
    INITIALISING:  ['UNPAIRED', 'CONNECTING', 'ERROR'],
    UNPAIRED:      ['PAIRING', 'CONNECTING', 'STOPPING', 'ERROR'],
    PAIRING:       ['UNPAIRED', 'CONNECTING', 'ONLINE', 'STOPPING', 'ERROR'],
    CONNECTING:    ['ONLINE', 'OFFLINE', 'RECONNECTING', 'STOPPING', 'ERROR'],
    ONLINE:        ['RECONNECTING', 'OFFLINE', 'PAIRING', 'STOPPING', 'ERROR'],
    RECONNECTING:  ['ONLINE', 'OFFLINE', 'STOPPING', 'ERROR'],
    OFFLINE:       ['RECONNECTING', 'CONNECTING', 'STOPPING', 'ERROR'],
    STOPPING:      ['ERROR'],
    ERROR:         [],
  };

  /**
   * Transition to a new state.
   * Throws if the transition is not valid.
   * Notifies all listeners after the transition.
   */
  transition(next: AgentState): void {
    const allowed = AgentStateManager.VALID_TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      throw new Error(
        `Invalid agent state transition: ${this.state} → ${next}`,
      );
    }
    const previous = this.state;
    this.state = next;
    this.listeners.forEach((cb) => cb(previous, next));
  }

  /**
   * Force a state without validation.
   * Use only in error recovery / shutdown paths.
   */
  forceTransition(next: AgentState): void {
    const previous = this.state;
    this.state = next;
    this.listeners.forEach((cb) => cb(previous, next));
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onChange(callback: AgentStateChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  is(state: AgentState): boolean {
    return this.state === state;
  }
}
