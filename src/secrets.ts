import 'dotenv/config';
import {readFileSync} from 'node:fs';
export function secret(name: string): string | undefined {
  const filename = process.env[name + '_FILE'];
  if (filename && process.env[name]) throw new Error(`Configure only ${name} or ${name}_FILE`);
  if (!filename) return process.env[name];
  const value = readFileSync(filename, 'utf8').trim();
  if (!value) throw new Error(`Empty ${name}_FILE`);
  return value;
}
