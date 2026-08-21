import type { AuthService, AuthSession } from '../AuthService';

/**
 * MockAuthService — always returns a pre-baked session.
 * The MVP skips the login screen; auth is assumed.
 *
 * Replace with a real OIDC / magic-link implementation.
 * SECURITY: never store raw passwords or tokens in AsyncStorage.
 * Use expo-secure-store for token persistence.
 */
export class MockAuthService implements AuthService {
  private session: AuthSession = {
    userId: 'mock-user-001',
    accessToken: 'mock-token-not-real',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  async getSession(): Promise<AuthSession | null> {
    return { ...this.session };
  }

  async signIn(_credentials: { email: string; password: string }): Promise<AuthSession> {
    return { ...this.session };
  }

  async signOut(): Promise<void> {
    console.log('[MockAuthService] Sign-out (no-op in mock)');
  }

  async isAuthenticated(): Promise<boolean> {
    return true;
  }
}
