import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';

export const maximumBundleBytes = 4 * 1024 * 1024;
export interface NetworkBundle {
  format: 1;
  chainId: number;
  genesis: string;
  genesisFileHash: string;
  genesisHash: string;
  bootnodes: string[];
  besuImage: string;
}

export function networkBundle(value: unknown, expectedChainId: number): NetworkBundle {
  if (!value || typeof value !== 'object') throw Error('Invalid network bundle');
  const bundle = value as Record<string, unknown>;
  if (bundle.format !== 1 || bundle.chainId !== expectedChainId || typeof bundle.genesis !== 'string' ||
      Buffer.byteLength(bundle.genesis) > maximumBundleBytes ||
      createHash('sha256').update(bundle.genesis).digest('hex') !== bundle.genesisFileHash)
    throw Error('Invalid network identity');
  const genesis = JSON.parse(bundle.genesis);
  if (Number(genesis.config?.chainId ?? genesis.config?.chainid) !== expectedChainId || !genesis.config?.qbft)
    throw Error('Expected the network QBFT genesis configuration');
  if (typeof bundle.genesisHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(bundle.genesisHash) ||
      typeof bundle.besuImage !== 'string' || !/^hyperledger\/besu:[a-zA-Z0-9_.-]+$/.test(bundle.besuImage))
    throw Error('Invalid network identity');
  if (!Array.isArray(bundle.bootnodes) || !bundle.bootnodes.length || bundle.bootnodes.length > 64 ||
      bundle.bootnodes.some(peer => {
        if (typeof peer !== 'string') return true;
        const match = peer.match(/^enode:\/\/[0-9a-fA-F]{128}@(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})$/);
        return !match || Number(match[2]) < 1 || Number(match[2]) > 65535;
      })) throw Error('Invalid network peers');
  // Only the documented public fields can leave the server. Never serialize
  // the original object, private node storage or application configuration.
  return {format: 1, chainId: expectedChainId, genesis: bundle.genesis,
    genesisFileHash: bundle.genesisFileHash as string, genesisHash: bundle.genesisHash.toLowerCase(),
    bootnodes: bundle.bootnodes as string[], besuImage: bundle.besuImage};
}

export async function readNetworkBundle(filename: string, chainId: number): Promise<NetworkBundle> {
  const info = await stat(filename);
  if (!info.isFile() || info.size > maximumBundleBytes) throw Error('Invalid network bundle file');
  const data = await readFile(filename);
  if (data.length > maximumBundleBytes) throw Error('Invalid network bundle file');
  return networkBundle(JSON.parse(data.toString('utf8')), chainId);
}

export async function readNetworkToken(filename: string): Promise<string> {
  const info = await stat(filename);
  if (!info.isFile() || (info.mode & 0o077)) throw Error('Use a private network bootstrap token file');
  const token = (await readFile(filename, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid network bootstrap token');
  return token;
}
