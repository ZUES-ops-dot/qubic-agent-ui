import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, getClientUserAgent, safeAppendAuditEvent, type AuditEventType, type AuditStatus } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AuditRequestBody {
  eventType?: AuditEventType;
  status?: AuditStatus;
  requestId?: string;
  route?: string;
  metadata?: Record<string, unknown>;
}

const ALLOWED_EVENT_TYPES: AuditEventType[] = [
  'contract_generation_attempt',
  'contract_generation_result',
  'devkit_pipeline_attempt',
  'devkit_pipeline_result',
];

const ALLOWED_STATUS: AuditStatus[] = ['started', 'success', 'error', 'blocked', 'cancelled'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  let body: AuditRequestBody;

  try {
    body = (await request.json()) as AuditRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.eventType || !ALLOWED_EVENT_TYPES.includes(body.eventType)) {
    return NextResponse.json({ ok: false, error: 'eventType is invalid.' }, { status: 400 });
  }

  if (!body.status || !ALLOWED_STATUS.includes(body.status)) {
    return NextResponse.json({ ok: false, error: 'status is invalid.' }, { status: 400 });
  }

  await safeAppendAuditEvent({
    eventType: body.eventType,
    status: body.status,
    requestId: body.requestId,
    route: body.route || request.nextUrl.pathname,
    source: 'client',
    ip: getClientIp(request),
    userAgent: getClientUserAgent(request),
    metadata: isRecord(body.metadata) ? body.metadata : {},
  });

  return NextResponse.json({ ok: true });
}
