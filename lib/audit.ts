import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NextRequest } from 'next/server';

const DEFAULT_AUDIT_LOG_PATH = join(process.cwd(), '.logs', 'audit.jsonl');
const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_ITEMS = 25;
const MAX_OBJECT_KEYS = 50;
const REDACTED_KEY_FRAGMENTS = [
  'apikey',
  'api_key',
  'token',
  'authorization',
  'password',
  'secret',
  'privatekey',
  'private_key',
  'bearer',
];

export type AuditEventType =
  | 'contract_generation_attempt'
  | 'contract_generation_result'
  | 'devkit_pipeline_attempt'
  | 'devkit_pipeline_result';

export type AuditStatus = 'started' | 'success' | 'error' | 'blocked' | 'cancelled';

interface AuditEventInput {
  eventType: AuditEventType;
  status: AuditStatus;
  requestId?: string;
  route?: string;
  source?: 'client' | 'server';
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

interface AuditRecord {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  status: AuditStatus;
  requestId?: string;
  route?: string;
  source?: 'client' | 'server';
  ipHash?: string;
  userAgent?: string;
  metadata?: unknown;
}

function getAuditLogPath(): string {
  const configured = process.env.QUBIC_AUDIT_LOG_PATH?.trim();
  return configured || DEFAULT_AUDIT_LOG_PATH;
}

function getAuditSalt(): string {
  return process.env.QUBIC_AUDIT_SALT?.trim() || 'qforge-audit';
}

function hashIp(ip: string): string {
  return createHash('sha256').update(`${getAuditSalt()}:${ip}`).digest('hex').slice(0, 24);
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return REDACTED_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment.replace(/[^a-z0-9]/g, '')));
}

function sanitizeValue(value: unknown, depth: number = 0): unknown {
  if (depth > 4) {
    return '[max-depth]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
      : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
    const sanitized: Record<string, unknown> = {};

    for (const [key, nestedValue] of entries) {
      sanitized[key] = shouldRedactKey(key) ? '[redacted]' : sanitizeValue(nestedValue, depth + 1);
    }

    return sanitized;
  }

  return '[unsupported-type]';
}

export function getClientIp(request: NextRequest): string | undefined {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  const requestWithIp = request as NextRequest & { ip?: string };
  return requestWithIp.ip?.trim();
}

export function getClientUserAgent(request: NextRequest): string {
  return request.headers.get('user-agent') || 'unknown';
}

export async function appendAuditEvent(input: AuditEventInput): Promise<void> {
  const record: AuditRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    eventType: input.eventType,
    status: input.status,
    requestId: input.requestId,
    route: input.route,
    source: input.source,
    ipHash: input.ip ? hashIp(input.ip) : undefined,
    userAgent: input.userAgent ? sanitizeValue(input.userAgent) as string : undefined,
    metadata: sanitizeValue(input.metadata || {}),
  };

  const logPath = getAuditLogPath();
  await fs.mkdir(dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function safeAppendAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    await appendAuditEvent(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[audit] Failed to append audit event:', message);
  }
}
