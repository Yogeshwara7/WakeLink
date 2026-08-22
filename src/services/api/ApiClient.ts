/**
 * ApiClient — thin HTTP client for the WakeLink backend.
 *
 * This is the ONLY place in the mobile app that knows the backend URL
 * and how to make HTTP requests. All API service implementations
 * (ApiDeviceService, ApiPairingService, etc.) use this client.
 *
 * ─────────────────────────────────────────────────────────────────────
 * CURRENT STATE:   Points to the local development backend (localhost).
 * PRODUCTION PATH: Replace BASE_URL with the real WakeLink Cloud URL.
 *                  Add Authorization header with the user's JWT token
 *                  once AuthService returns a real session.
 * ─────────────────────────────────────────────────────────────────────
 *
 * SECURITY:
 *   - Auth tokens are injected per-request via getToken() callback.
 *   - The token is never stored inside this class.
 *   - The real backend must use TLS (HTTPS). This client supports both
 *     HTTP (dev) and HTTPS (prod) transparently via fetch.
 */

export interface ApiClientConfig {
  /** Base URL of the WakeLink backend, no trailing slash. */
  baseUrl: string;
  /**
   * Optional async function that returns the current auth token.
   * Return null if the user is not authenticated.
   * Called on every request so token refresh is transparent.
   */
  getToken?: () => Promise<string | null>;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: (() => Promise<string | null>) | undefined;
  private readonly timeoutMs: number;

  constructor(config: ApiClientConfig) {
    this.baseUrl   = config.baseUrl.replace(/\/$/, '');
    this.getToken  = config.getToken;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    };

    // Inject auth token if available
    if (this.getToken) {
      const token = await this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body:   body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      if (!response.ok) {
        throw new ApiClientError(
          response.status,
          `${method} ${path} failed with status ${response.status}`,
          data,
        );
      }

      return data as T;
    } catch (err) {
      if (err instanceof ApiClientError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiClientError(0, `Request timed out: ${method} ${path}`);
      }
      throw new ApiClientError(
        0,
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
