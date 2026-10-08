import {timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
export function proxyClient(headers: Record<string, unknown>, fallback: string, key?: string): string {
  const supplied = headers['x-traceforge-proxy-key'];
  const ip = headers['x-traceforge-client-ip'];
  if (!key || typeof supplied !== 'string' || typeof ip !== 'string' || !isIP(ip)) return fallback;
  const actual = Buffer.from(supplied), expected = Buffer.from(key);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? ip : fallback;
}
