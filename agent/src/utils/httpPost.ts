import * as http from 'http';
import * as https from 'https';

/**
 * Minimal HTTP/HTTPS POST helper — avoids pulling in axios/node-fetch.
 * Returns the parsed JSON response body.
 */
export function httpPost<T = unknown>(url: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify(body);
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = (isHttps ? https : http).request(options, (res) => {
      let raw = '';
      res.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            resolve(raw as unknown as T);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${raw}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('Request timed out')));
    req.write(data);
    req.end();
  });
}
