import { NextRequest, NextResponse } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

type RequestBucket = number[];

declare global {
  var __qforgeRateLimitStore: Map<string, RequestBucket> | undefined;
}

function getRateLimitStore(): Map<string, RequestBucket> {
  if (!globalThis.__qforgeRateLimitStore) {
    globalThis.__qforgeRateLimitStore = new Map<string, RequestBucket>();
  }

  return globalThis.__qforgeRateLimitStore;
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  const requestWithIp = request as NextRequest & { ip?: string };
  return requestWithIp.ip?.trim() || 'unknown';
}

function withRateLimitHeaders(response: NextResponse, remaining: number, resetSeconds: number): NextResponse {
  response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
  response.headers.set('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  response.headers.set('X-RateLimit-Reset', String(resetSeconds));
  return response;
}

function cleanupExpiredEntries(store: Map<string, RequestBucket>, now: number): void {
  for (const [key, timestamps] of store.entries()) {
    const active = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (active.length === 0) {
      store.delete(key);
      continue;
    }

    store.set(key, active);
  }
}

export function middleware(request: NextRequest): NextResponse {
  const store = getRateLimitStore();
  const now = Date.now();

  cleanupExpiredEntries(store, now);

  const ip = getClientIp(request);
  const key = `${ip}:${request.nextUrl.pathname}`;
  const existing = store.get(key) || [];
  const activeTimestamps = existing.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);

  if (activeTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = activeTimestamps[0] || now;
    const resetSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));

    const limited = NextResponse.json(
      {
        ok: false,
        error: 'Rate limit exceeded. Maximum 10 API requests per minute per IP.',
      },
      { status: 429 }
    );

    return withRateLimitHeaders(limited, 0, resetSeconds);
  }

  activeTimestamps.push(now);
  store.set(key, activeTimestamps);

  const oldest = activeTimestamps[0] || now;
  const resetSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
  const remaining = RATE_LIMIT_MAX_REQUESTS - activeTimestamps.length;

  return withRateLimitHeaders(NextResponse.next(), remaining, resetSeconds);
}

export const config = {
  matcher: ['/api/:path*'],
};
