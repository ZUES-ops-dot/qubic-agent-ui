import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_ENDPOINTS = [
  '/api/oracle/query',
  '/api/tools/oracle/query',
  '/oracle/query',
];

interface ToolkitBridgeBody {
  toolkitUrl?: string;
  toolkitToken?: string;
  query?: unknown;
  explicitEndpoint?: string;
}

function normalizeToolkitUrl(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

function validateToolkitUrl(input: string): URL {
  const parsed = new URL(input);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Toolkit URL must use http:// or https://');
  }

  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('Toolkit URL must point to localhost or 127.0.0.1 for safety');
  }

  return parsed;
}

async function primeToolkitSession(toolkitUrl: string, toolkitToken?: string): Promise<string | null> {
  if (!toolkitToken?.trim()) {
    return null;
  }

  const launchUrl = new URL(toolkitUrl);
  launchUrl.searchParams.set('token', toolkitToken.trim());

  const primeResponse = await fetch(launchUrl.toString(), {
    method: 'GET',
    redirect: 'manual',
  });

  const cookieHeader = primeResponse.headers.get('set-cookie');
  if (!cookieHeader) {
    return null;
  }

  const firstCookie = cookieHeader.split(',')[0];
  return firstCookie.split(';')[0] || null;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ToolkitBridgeBody;
    const toolkitUrlRaw = body.toolkitUrl?.trim();

    if (!toolkitUrlRaw) {
      return NextResponse.json({ ok: false, error: 'toolkitUrl is required' }, { status: 400 });
    }

    if (!body.query) {
      return NextResponse.json({ ok: false, error: 'query payload is required' }, { status: 400 });
    }

    const normalizedToolkitUrl = normalizeToolkitUrl(toolkitUrlRaw);
    validateToolkitUrl(normalizedToolkitUrl);

    const endpoints = body.explicitEndpoint?.trim()
      ? [body.explicitEndpoint.trim()]
      : DEFAULT_ENDPOINTS;

    const sessionCookie = await primeToolkitSession(normalizedToolkitUrl, body.toolkitToken);

    const attempts: Array<{ endpoint: string; status: number; body: unknown }> = [];

    for (const endpoint of endpoints) {
      const target = endpoint.startsWith('http://') || endpoint.startsWith('https://')
        ? endpoint
        : `${normalizedToolkitUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

      try {
        const response = await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionCookie ? { Cookie: sessionCookie } : {}),
          },
          body: JSON.stringify(body.query),
        });

        const payload = await readResponseBody(response);
        attempts.push({ endpoint: target, status: response.status, body: payload });

        if (response.ok) {
          return NextResponse.json({
            ok: true,
            endpoint: target,
            response: payload,
          });
        }
      } catch (error) {
        attempts.push({
          endpoint: target,
          status: 0,
          body: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: 'Toolkit did not expose a compatible REST endpoint. Open Toolkit UI directly and use the generated payload preview.',
        attempts,
      },
      { status: 502 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
