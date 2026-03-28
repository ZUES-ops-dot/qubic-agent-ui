import { getSettingsAsync } from './storage';

export type DevkitPipelineAction = 'compile' | 'deploy';
export type DeploymentNetwork = 'testnet' | 'mainnet';

export interface DevkitCommandResult {
  success: boolean;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
}

export interface DevkitStatusResponse {
  ok: boolean;
  enabled: boolean;
  ready: boolean;
  network: DeploymentNetwork;
  commands: {
    compileConfigured: boolean;
    verifyConfigured: boolean;
    deployConfigured: boolean;
    sandboxConfigured?: boolean;
    mainnetDeployEnabled: boolean;
  };
  rpc: {
    url: string;
    reachable: boolean;
    tick: number;
  };
  notes: string[];
}

export interface DevkitPipelineRequest {
  action: DevkitPipelineAction;
  code: string;
  contractName?: string;
  network?: DeploymentNetwork;
}

export interface DevkitPipelineResponse {
  ok: boolean;
  requestId?: string;
  action: DevkitPipelineAction;
  message: string;
  network?: DeploymentNetwork;
  workspace?: string;
  contractName?: string;
  contractId?: string;
  txHash?: string;
  compile?: DevkitCommandResult;
  verify?: DevkitCommandResult;
  deploy?: DevkitCommandResult;
  artifactFiles?: string[];
  notes?: string[];
  error?: string;
}

const DEVKIT_PIPELINE_ENDPOINT = '/api/devkit/pipeline';

async function withDevkitToken(headers: Record<string, string>): Promise<Record<string, string>> {
  const token = (await getSettingsAsync()).devkitBridgeToken?.trim();
  if (token) {
    return {
      ...headers,
      'x-devkit-token': token,
    };
  }

  return headers;
}

async function readJson<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String((payload as { error?: unknown }).error || `Request failed (${response.status})`)
      : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

export async function getDevkitStatus(network: DeploymentNetwork = 'testnet'): Promise<DevkitStatusResponse> {
  const endpoint = `${DEVKIT_PIPELINE_ENDPOINT}?network=${network}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: await withDevkitToken({
      Accept: 'application/json',
    }),
  });

  return readJson<DevkitStatusResponse>(response);
}

export async function runDevkitPipeline(payload: DevkitPipelineRequest): Promise<DevkitPipelineResponse> {
  const response = await fetch(DEVKIT_PIPELINE_ENDPOINT, {
    method: 'POST',
    headers: await withDevkitToken({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify(payload),
  });

  return readJson<DevkitPipelineResponse>(response);
}

export function formatDevkitCommandResult(result?: DevkitCommandResult): string {
  if (!result) {
    return '';
  }

  const parts = [
    `command: ${result.command}`,
    `exitCode: ${result.exitCode === null ? 'null' : result.exitCode}`,
    `durationMs: ${result.durationMs}`,
  ];

  if (result.stdout.trim()) {
    parts.push('', 'stdout:', result.stdout.trim());
  }

  if (result.stderr.trim()) {
    parts.push('', 'stderr:', result.stderr.trim());
  }

  return parts.join('\n');
}

export function summarizeDevkitPipelineResponse(response: DevkitPipelineResponse): string {
  const sections: string[] = [response.message];

  if (response.network) {
    sections.push(`network: ${response.network}`);
  }

  if (response.compile) {
    sections.push('', '[compile]', formatDevkitCommandResult(response.compile));
  }

  if (response.verify) {
    sections.push('', '[verify]', formatDevkitCommandResult(response.verify));
  }

  if (response.deploy) {
    sections.push('', '[deploy]', formatDevkitCommandResult(response.deploy));
  }

  if (response.contractId) {
    sections.push('', `contractId: ${response.contractId}`);
  }

  if (response.txHash) {
    sections.push(`txHash: ${response.txHash}`);
  }

  if (response.notes && response.notes.length > 0) {
    sections.push('', 'notes:', ...response.notes.map((note) => `- ${note}`));
  }

  return sections.filter(Boolean).join('\n');
}
