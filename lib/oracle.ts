export type OracleInterface = 'price' | 'test';

export interface PriceOracleDraft {
  interface: 'price';
  oracleSource: string;
  currency1: string;
  currency2: string;
  timeoutSeconds: number;
  timestamp: Date;
}

export interface TestOracleDraft {
  interface: 'test';
  value: number;
  timeoutSeconds: number;
}

export type OracleDraft = PriceOracleDraft | TestOracleDraft;

export interface OraclePayloadPreview {
  interfaceIndex: number;
  timeoutMilliseconds: number;
  bytes: Uint8Array;
  hex: string;
  base64: string;
  description: string;
}

export interface ToolkitBridgeRequest {
  toolkitUrl: string;
  toolkitToken?: string;
  query: OracleDraft;
  explicitEndpoint?: string;
}

export interface ToolkitBridgeResponse {
  ok: boolean;
  endpoint?: string;
  note?: string;
  response?: unknown;
}

export const ORACLE_SOURCES = [
  { value: 'binance', label: 'Binance' },
  { value: 'mexc', label: 'MEXC' },
  { value: 'gate', label: 'Gate.io' },
  { value: 'coingecko', label: 'CoinGecko' },
  { value: 'binance_mexc', label: 'Binance + MEXC' },
  { value: 'binance_gate', label: 'Binance + Gate.io' },
  { value: 'gate_mexc', label: 'Gate.io + MEXC' },
] as const;

export const ORACLE_PAIR_PRESETS: Record<string, string[]> = {
  binance: ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'DOT/USDT', 'Custom'],
  mexc: ['QUBIC/USDT', 'BTC/USDT', 'ETH/USDT', 'Custom'],
  gate: ['QUBIC/USDT', 'BTC/USDT', 'ETH/USDT', 'Custom'],
  coingecko: ['BTC/USDT', 'ETH/USDT', 'Custom'],
  binance_mexc: ['QUBIC/USDT', 'BTC/USDT', 'ETH/USDT', 'Custom'],
  binance_gate: ['QUBIC/USDT', 'BTC/USDT', 'ETH/USDT', 'Custom'],
  gate_mexc: ['QUBIC/USDT', 'BTC/USDT', 'ETH/USDT', 'Custom'],
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(bytes: Uint8Array): string {
  if (typeof window === 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

function writeUint64LE(bytes: Uint8Array, offset: number, value: number): void {
  const normalized = Math.max(0, Math.floor(value));
  const low = normalized >>> 0;
  const high = Math.floor(normalized / 4294967296) >>> 0;
  writeUint32LE(bytes, offset, low);
  writeUint32LE(bytes, offset + 4, high);
}

function setBits(bytes: Uint8Array, startBit: number, bitLength: number, value: number): void {
  for (let i = 0; i < bitLength; i += 1) {
    const bitValue = (value >> i) & 1;
    if (!bitValue) {
      continue;
    }

    const bitPosition = startBit + i;
    const byteIndex = Math.floor(bitPosition / 8);
    const bitOffset = bitPosition % 8;
    bytes[byteIndex] |= 1 << bitOffset;
  }
}

function encodeId(name: string): Uint8Array {
  const bytes = new Uint8Array(32);
  const normalized = name.trim().toUpperCase();
  for (let i = 0; i < Math.min(normalized.length, 32); i += 1) {
    bytes[i] = normalized.charCodeAt(i);
  }
  return bytes;
}

function encodeDateAndTime(date: Date): Uint8Array {
  const utcDate = new Date(date);
  const bytes = new Uint8Array(8);

  setBits(bytes, 10, 10, utcDate.getUTCMilliseconds());
  setBits(bytes, 20, 6, utcDate.getUTCSeconds());
  setBits(bytes, 26, 6, utcDate.getUTCMinutes());
  setBits(bytes, 32, 5, utcDate.getUTCHours());
  setBits(bytes, 37, 5, utcDate.getUTCDate());
  setBits(bytes, 42, 4, utcDate.getUTCMonth() + 1);
  setBits(bytes, 46, 12, utcDate.getUTCFullYear());

  return bytes;
}

function clampTimeout(timeoutSeconds: number): number {
  if (Number.isNaN(timeoutSeconds)) {
    return 60;
  }
  return Math.min(3600, Math.max(1, Math.floor(timeoutSeconds)));
}

export function splitPair(pair: string): { currency1: string; currency2: string } {
  const parts = pair
    .split('/')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  return {
    currency1: parts[0] || '',
    currency2: parts[1] || '',
  };
}

export function buildOraclePayload(draft: OracleDraft): OraclePayloadPreview {
  if (draft.interface === 'price') {
    const timeoutMilliseconds = clampTimeout(draft.timeoutSeconds) * 1000;
    const bytes = new Uint8Array(112);

    writeUint32LE(bytes, 0, 0);
    writeUint32LE(bytes, 4, timeoutMilliseconds);
    bytes.set(encodeId(draft.oracleSource), 8);
    bytes.set(encodeDateAndTime(draft.timestamp), 40);
    bytes.set(encodeId(draft.currency1), 48);
    bytes.set(encodeId(draft.currency2), 80);

    return {
      interfaceIndex: 0,
      timeoutMilliseconds,
      bytes,
      hex: toHex(bytes),
      base64: toBase64(bytes),
      description: `${draft.oracleSource.toUpperCase()} ${draft.currency1}/${draft.currency2}`,
    };
  }

  const timeoutMilliseconds = clampTimeout(draft.timeoutSeconds) * 1000;
  const bytes = new Uint8Array(16);
  writeUint32LE(bytes, 0, 1);
  writeUint32LE(bytes, 4, timeoutMilliseconds);
  writeUint64LE(bytes, 8, Math.max(0, Math.floor(draft.value)));

  return {
    interfaceIndex: 1,
    timeoutMilliseconds,
    bytes,
    hex: toHex(bytes),
    base64: toBase64(bytes),
    description: `Test value=${Math.max(0, Math.floor(draft.value))}`,
  };
}

export function formatToolkitLaunchUrl(toolkitUrl: string, toolkitToken?: string): string {
  const trimmed = toolkitUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }

  if (!toolkitToken?.trim()) {
    return trimmed;
  }

  const separator = trimmed.includes('?') ? '&' : '?';
  return `${trimmed}${separator}token=${encodeURIComponent(toolkitToken.trim())}`;
}

export async function submitOracleQueryViaToolkitBridge(
  payload: ToolkitBridgeRequest
): Promise<ToolkitBridgeResponse> {
  const response = await fetch('/api/oracle/toolkit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Failed to send query to toolkit bridge');
  }

  return data as ToolkitBridgeResponse;
}
