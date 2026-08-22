import * as http from 'http';
import * as https from 'https';

/** Minimal HTTP GET — returns parsed JSON. */
export function httpGet<T>(url: string, token?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = (isHttps ? https : http).request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c: Buffer) => { raw += c.toString(); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(raw) as T); } catch { resolve(raw as unknown as T); }
          } else {
            reject(new Error(`HTTP ${res.statusCode} GET ${url}: ${raw}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('GET timed out')));
    req.end();
  });
}

/** Minimal HTTP POST — sends JSON body, returns parsed JSON. */
export function httpPost<T>(url: string, body: unknown, token?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify(body);
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const headers: Record<string, string> = {
      'Content-Type':   'application/json',
      'Content-Length': String(Buffer.byteLength(data)),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = (isHttps ? https : http).request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c: Buffer) => { raw += c.toString(); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(raw) as T); } catch { resolve(raw as unknown as T); }
          } else {
            reject(new Error(`HTTP ${res.statusCode} POST ${url}: ${raw}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('POST timed out')));
    req.write(data);
    req.end();
  });
}
