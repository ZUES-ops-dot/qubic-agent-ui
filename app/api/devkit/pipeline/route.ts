import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getClientIp, getClientUserAgent, safeAppendAuditEvent, type AuditStatus } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TESTNET_RPC = 'https://testnet-rpc.qubicdev.com';
const MAINNET_RPC = 'https://rpc.qubic.org';
const OUTPUT_LIMIT = 12_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_CONTRACT_SOURCE_BYTES = 512_000;
const MAX_REQUEST_BODY_BYTES = 768_000;

type DeploymentNetwork = 'testnet' | 'mainnet';
type PipelineAction = 'compile' | 'deploy';

interface PipelineRequestBody {
  action?: PipelineAction;
  code?: string;
  contractName?: string;
  network?: DeploymentNetwork;
}

interface CommandResult {
  success: boolean;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
}

interface DevkitConfig {
  enabled: boolean;
  compileCommand: string;
  verifyCommand: string;
  deployCommand: string;
  sandboxCommand: string;
  timeoutMs: number;
  keepWorkspace: boolean;
  allowMainnet: boolean;
}

async function parsePipelineBody(request: NextRequest): Promise<PipelineRequestBody | null> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return null;
    }

    return body as PipelineRequestBody;
  } catch {
    return null;
  }
}

function clipOutput(value: string): string {
  if (value.length <= OUTPUT_LIMIT) {
    return value;
  }

  const half = Math.floor(OUTPUT_LIMIT / 2);
  return `${value.slice(0, half)}\n...<output truncated>...\n${value.slice(-half)}`;
}

function sanitizeContractName(raw: string | undefined): string {
  const cleaned = (raw || 'UserContract').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64);
  return cleaned || 'UserContract';
}

function readConfig(): DevkitConfig {
  const parsedTimeout = Number(process.env.QUBIC_DEVKIT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    enabled: process.env.QUBIC_DEVKIT_ENABLE_EXEC === '1',
    compileCommand: (process.env.QUBIC_DEVKIT_COMPILE_CMD || '').trim(),
    verifyCommand: (process.env.QUBIC_DEVKIT_VERIFY_CMD || '').trim(),
    deployCommand: (process.env.QUBIC_DEVKIT_DEPLOY_CMD || '').trim(),
    sandboxCommand: (process.env.QUBIC_DEVKIT_SANDBOX_CMD || '').trim(),
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS,
    keepWorkspace: process.env.QUBIC_DEVKIT_KEEP_WORKSPACE === '1',
    allowMainnet: process.env.QUBIC_DEVKIT_ALLOW_MAINNET === '1',
  };
}

function interpolateCommand(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (_, key: string) => values[key.toLowerCase()] || '');
}

function validateSandboxCommand(template: string): string | null {
  if (!template.trim()) {
    return 'QUBIC_DEVKIT_SANDBOX_CMD is required. Host command execution is disabled for production safety.';
  }

  if (!template.includes('{command}')) {
    return 'QUBIC_DEVKIT_SANDBOX_CMD must include the {command} placeholder.';
  }

  return null;
}

async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  sandboxTemplate: string,
  substitutions: Record<string, string>
): Promise<CommandResult> {
  const wrappedCommand = interpolateCommand(sandboxTemplate, {
    ...substitutions,
    command,
    cwd,
    workspace: cwd,
  });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(wrappedCommand, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finalize = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;

      resolve({
        success: exitCode === 0 && !timedOut,
        command,
        exitCode,
        stdout: clipOutput(stdout),
        stderr: clipOutput(stderr),
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      stderr += `\n[spawn error] ${error.message}`;
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      finalize(code);
    });
  });
}

async function createWorkspace(contractName: string, code: string): Promise<{ workspace: string; contractFile: string }> {
  const workspace = join(tmpdir(), 'qubic-agent-ui-devkit', randomUUID());
  await fs.mkdir(workspace, { recursive: true });

  const contractFile = join(workspace, `${contractName}.h`);
  await fs.writeFile(contractFile, code, 'utf8');

  return { workspace, contractFile };
}

async function listWorkspaceArtifacts(workspace: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(workspace, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .slice(0, 25);
  } catch {
    return [];
  }
}

async function checkRpc(rpcUrl: string): Promise<{ reachable: boolean; tick: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch(`${rpcUrl}/v1/tick-info`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { reachable: false, tick: 0 };
    }

    const data = await response.json();
    const tick = Number(data.tick || data.tickInfo?.tick || 0);
    return { reachable: true, tick: Number.isFinite(tick) ? tick : 0 };
  } catch {
    return { reachable: false, tick: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

function ensureBridgeAccess(request: NextRequest): string | null {
  const allowRemote = process.env.QUBIC_DEVKIT_ALLOW_REMOTE === '1';
  const host = request.headers.get('host') || '';
  const isLocalHost = /^localhost(?::\d+)?$/i.test(host) || /^127\.0\.0\.1(?::\d+)?$/i.test(host);

  if (!allowRemote && !isLocalHost) {
    return 'Remote access is disabled for /api/devkit/pipeline. Use localhost or set QUBIC_DEVKIT_ALLOW_REMOTE=1.';
  }

  const requiredToken = process.env.QUBIC_DEVKIT_BRIDGE_TOKEN;
  if (requiredToken) {
    const requestToken = request.headers.get('x-devkit-token');
    if (requestToken !== requiredToken) {
      return 'Missing or invalid x-devkit-token header.';
    }
  }

  return null;
}

function extractDeploymentMarkers(output: string): { contractId?: string; txHash?: string } {
  const contractIdMatch = output.match(/\bBA[A-Z0-9]{58}\b/);
  const txHashMatch = output.match(/\b[a-f0-9]{64}\b/i);

  return {
    contractId: contractIdMatch?.[0],
    txHash: txHashMatch?.[0],
  };
}

async function auditPipelineEvent(
  request: NextRequest,
  eventType: 'devkit_pipeline_attempt' | 'devkit_pipeline_result',
  status: AuditStatus,
  requestId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await safeAppendAuditEvent({
    eventType,
    status,
    requestId,
    route: request.nextUrl.pathname,
    source: 'server',
    ip: getClientIp(request),
    userAgent: getClientUserAgent(request),
    metadata,
  });
}

export async function GET(request: NextRequest) {
  const accessError = ensureBridgeAccess(request);
  if (accessError) {
    return NextResponse.json({ ok: false, error: accessError }, { status: 403 });
  }

  const config = readConfig();
  const requestedNetwork = request.nextUrl.searchParams.get('network');
  const network: DeploymentNetwork = requestedNetwork === 'mainnet' ? 'mainnet' : 'testnet';
  const rpcUrl = process.env.QUBIC_DEPLOY_RPC || (network === 'mainnet' ? MAINNET_RPC : TESTNET_RPC);
  const rpc = await checkRpc(rpcUrl);
  const sandboxError = validateSandboxCommand(config.sandboxCommand);

  const notes: string[] = [];

  if (!config.enabled) {
    notes.push('Command execution is disabled. Set QUBIC_DEVKIT_ENABLE_EXEC=1 to enable compile/deploy actions.');
  }
  if (!config.compileCommand) {
    notes.push('QUBIC_DEVKIT_COMPILE_CMD is not configured.');
  }
  if (!config.deployCommand) {
    notes.push('QUBIC_DEVKIT_DEPLOY_CMD is not configured.');
  }
  if (sandboxError) {
    notes.push(sandboxError);
  }
  if (!config.keepWorkspace) {
    notes.push('Temporary Dev Kit workspaces are auto-cleaned after each pipeline run. Set QUBIC_DEVKIT_KEEP_WORKSPACE=1 to retain for debugging.');
  }
  if (network === 'mainnet' && !config.allowMainnet) {
    notes.push('Mainnet deploy is blocked. Set QUBIC_DEVKIT_ALLOW_MAINNET=1 to explicitly allow mainnet deploy commands.');
  }
  if (!rpc.reachable) {
    notes.push(`RPC endpoint is unreachable: ${rpcUrl}`);
  }

  return NextResponse.json({
    ok: true,
    enabled: config.enabled,
    ready: config.enabled
      && Boolean(config.compileCommand)
      && Boolean(config.deployCommand)
      && !sandboxError
      && (network !== 'mainnet' || config.allowMainnet),
    network,
    commands: {
      compileConfigured: Boolean(config.compileCommand),
      verifyConfigured: Boolean(config.verifyCommand),
      deployConfigured: Boolean(config.deployCommand),
      sandboxConfigured: !sandboxError,
      mainnetDeployEnabled: config.allowMainnet,
    },
    rpc: {
      url: rpcUrl,
      reachable: rpc.reachable,
      tick: rpc.tick,
    },
    notes,
  });
}

export async function POST(request: NextRequest) {
  const accessError = ensureBridgeAccess(request);
  if (accessError) {
    return NextResponse.json({ ok: false, error: accessError }, { status: 403 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `Request body exceeds maximum allowed size (${MAX_REQUEST_BODY_BYTES} bytes).`,
      },
      { status: 413 }
    );
  }

  const config = readConfig();
  const sandboxError = validateSandboxCommand(config.sandboxCommand);

  if (!config.enabled) {
    return NextResponse.json(
      {
        ok: false,
        error: 'QUBIC_DEVKIT_ENABLE_EXEC is not enabled. Set QUBIC_DEVKIT_ENABLE_EXEC=1 for compile/deploy execution.',
      },
      { status: 400 }
    );
  }

  if (sandboxError) {
    return NextResponse.json(
      {
        ok: false,
        error: sandboxError,
      },
      { status: 400 }
    );
  }

  const body = await parsePipelineBody(request);
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const action = body.action;

  if (action !== 'compile' && action !== 'deploy') {
    return NextResponse.json({ ok: false, error: 'action must be "compile" or "deploy"' }, { status: 400 });
  }

  const code = body.code || '';
  if (!code.trim()) {
    return NextResponse.json({ ok: false, error: 'code is required' }, { status: 400 });
  }

  const codeBytes = Buffer.byteLength(code, 'utf8');
  if (codeBytes > MAX_CONTRACT_SOURCE_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `code exceeds maximum allowed size (${MAX_CONTRACT_SOURCE_BYTES} bytes).`,
      },
      { status: 413 }
    );
  }

  const contractName = sanitizeContractName(body.contractName);
  const network: DeploymentNetwork = body.network === 'mainnet' ? 'mainnet' : 'testnet';
  const rpcUrl = process.env.QUBIC_DEPLOY_RPC || (network === 'mainnet' ? MAINNET_RPC : TESTNET_RPC);
  const requestId = randomUUID();

  const auditMetadataBase: Record<string, unknown> = {
    action,
    network,
    contractName,
    codeBytes,
    mainnetAllowed: config.allowMainnet,
    keepWorkspace: config.keepWorkspace,
  };

  await auditPipelineEvent(request, 'devkit_pipeline_attempt', 'started', requestId, auditMetadataBase);

  if (action === 'deploy' && network === 'mainnet' && !config.allowMainnet) {
    await auditPipelineEvent(request, 'devkit_pipeline_result', 'blocked', requestId, {
      ...auditMetadataBase,
      reason: 'mainnet-disabled',
    });

    return NextResponse.json(
      {
        ok: false,
        requestId,
        action,
        network,
        error: 'Mainnet deploy is disabled. Set QUBIC_DEVKIT_ALLOW_MAINNET=1 to enable mainnet deployment commands.',
      },
      { status: 403 }
    );
  }

  const { workspace, contractFile } = await createWorkspace(contractName, code);
  const workspaceForResponse = config.keepWorkspace ? workspace : undefined;

  const substitutions: Record<string, string> = {
    workspace,
    contract_file: contractFile,
    contract_name: contractName,
    network,
    rpc_url: rpcUrl,
  };

  try {
    if (!config.compileCommand) {
      await auditPipelineEvent(request, 'devkit_pipeline_result', 'blocked', requestId, {
        ...auditMetadataBase,
        reason: 'compile-command-missing',
      });

      return NextResponse.json(
        {
          ok: false,
          requestId,
          action,
          network,
          message: 'Compile command missing. Configure QUBIC_DEVKIT_COMPILE_CMD.',
          error: 'QUBIC_DEVKIT_COMPILE_CMD is required for pipeline execution.',
          workspace: workspaceForResponse,
        },
        { status: 400 }
      );
    }

    const compileCommand = interpolateCommand(config.compileCommand, substitutions);
    const compile = await runShellCommand(compileCommand, workspace, config.timeoutMs, config.sandboxCommand, substitutions);

    if (!compile.success) {
      await auditPipelineEvent(request, 'devkit_pipeline_result', 'error', requestId, {
        ...auditMetadataBase,
        phase: 'compile',
        exitCode: compile.exitCode,
        timedOut: compile.timedOut || false,
      });

      return NextResponse.json(
        {
          ok: false,
          requestId,
          action,
          network,
          message: 'Compilation failed.',
          workspace: workspaceForResponse,
          contractName,
          compile,
          artifactFiles: await listWorkspaceArtifacts(workspace),
        },
        { status: 200 }
      );
    }

    let verify: CommandResult | undefined;
    if (config.verifyCommand) {
      const verifyCommand = interpolateCommand(config.verifyCommand, substitutions);
      verify = await runShellCommand(verifyCommand, workspace, config.timeoutMs, config.sandboxCommand, substitutions);

      if (!verify.success) {
        await auditPipelineEvent(request, 'devkit_pipeline_result', 'error', requestId, {
          ...auditMetadataBase,
          phase: 'verify',
          exitCode: verify.exitCode,
          timedOut: verify.timedOut || false,
        });

        return NextResponse.json(
          {
            ok: false,
            requestId,
            action,
            network,
            message: 'Verification command failed.',
            workspace: workspaceForResponse,
            contractName,
            compile,
            verify,
            artifactFiles: await listWorkspaceArtifacts(workspace),
          },
          { status: 200 }
        );
      }
    }

    if (action === 'compile') {
      await auditPipelineEvent(request, 'devkit_pipeline_result', 'success', requestId, {
        ...auditMetadataBase,
        phase: 'compile',
        verifyRan: Boolean(verify),
      });

      return NextResponse.json({
        ok: true,
        requestId,
        action,
        network,
        message: 'Compilation pipeline completed.',
        workspace: workspaceForResponse,
        contractName,
        compile,
        verify,
        artifactFiles: await listWorkspaceArtifacts(workspace),
        notes: [
          'Contract compiled via configured sandbox wrapper command.',
          'Next step: deploy command (proposal + IPO flow for mainnet).',
          'Execution was isolated by QUBIC_DEVKIT_SANDBOX_CMD.',
          !config.keepWorkspace ? 'Workspace was auto-cleaned after execution.' : 'Workspace retained (QUBIC_DEVKIT_KEEP_WORKSPACE=1).',
        ],
      });
    }

    if (!config.deployCommand) {
      await auditPipelineEvent(request, 'devkit_pipeline_result', 'blocked', requestId, {
        ...auditMetadataBase,
        reason: 'deploy-command-missing',
      });

      return NextResponse.json(
        {
          ok: false,
          requestId,
          action,
          network,
          message: 'Deploy command missing. Configure QUBIC_DEVKIT_DEPLOY_CMD.',
          workspace: workspaceForResponse,
          contractName,
          compile,
          verify,
          artifactFiles: await listWorkspaceArtifacts(workspace),
        },
        { status: 400 }
      );
    }

    const deployCommand = interpolateCommand(config.deployCommand, substitutions);
    const deploy = await runShellCommand(deployCommand, workspace, config.timeoutMs, config.sandboxCommand, substitutions);
    const markers = extractDeploymentMarkers(`${deploy.stdout}\n${deploy.stderr}`);

    await auditPipelineEvent(request, 'devkit_pipeline_result', deploy.success ? 'success' : 'error', requestId, {
      ...auditMetadataBase,
      phase: 'deploy',
      exitCode: deploy.exitCode,
      timedOut: deploy.timedOut || false,
      contractId: markers.contractId,
      txHash: markers.txHash,
    });

    return NextResponse.json({
      ok: deploy.success,
      requestId,
      action,
      network,
      message: deploy.success
        ? 'Deploy command completed. Review output for proposal/IPO confirmation.'
        : 'Deploy command failed. Review stderr/output below.',
      workspace: workspaceForResponse,
      contractName,
      contractId: markers.contractId,
      txHash: markers.txHash,
      compile,
      verify,
      deploy,
      artifactFiles: await listWorkspaceArtifacts(workspace),
      notes: deploy.success
        ? [
            'Qubic mainnet activation still requires Quorum approval and IPO lifecycle.',
            `RPC target used for this run: ${rpcUrl}`,
            'Execution was isolated by QUBIC_DEVKIT_SANDBOX_CMD.',
            !config.keepWorkspace ? 'Workspace was auto-cleaned after execution.' : 'Workspace retained (QUBIC_DEVKIT_KEEP_WORKSPACE=1).',
          ]
        : [
            `RPC target: ${rpcUrl}`,
            'Execution was isolated by QUBIC_DEVKIT_SANDBOX_CMD.',
            !config.keepWorkspace ? 'Workspace was auto-cleaned after execution.' : 'Workspace retained (QUBIC_DEVKIT_KEEP_WORKSPACE=1).',
          ],
    });
  } finally {
    if (!config.keepWorkspace) {
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
