/**
 * AuthService — authentication abstraction.
 *
 * The MVP does not implement real auth, but this interface ensures
 * no screen hardcodes auth logic.  Replace with a real OIDC / JWT
 * implementation without touching any UI code.
 *
 * SECURITY NOTE:
 *   - Never store raw passwords.
 *   - Tokens must be stored in the platform secure keychain,
 *     NOT in AsyncStorage or localStorage.
 */
export interface AuthSession {
  userId: string;
  /** Opaque token — implementation detail of the concrete service. */
  accessToken: string;
  expiresAt: string;
}

export interface AuthService {
  /** Returns the current session, or null if not signed in. */
  getSession(): Promise<AuthSession | null>;

  /**
   * Signs in the user.
   * Real implementation: OAuth2 PKCE / magic-link / social login.
   */
  signIn(credentials: { email: string; password: string }): Promise<AuthSession>;

  signOut(): Promise<void>;

  /** True if a valid (non-expired) session exists. */
  isAuthenticated(): Promise<boolean>;
}
