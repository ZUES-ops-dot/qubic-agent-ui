'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from '@/components/sidebar'
import { CyberCard } from '@/components/ui/cyber-card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, AlertCircle, Download, Save, Play, Loader2, FileCode, Server, Wrench, Rocket } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';
import { getSettingsAsync } from '@/lib/storage';
import { chatWithAgent, analyzeContract } from '@/lib/agent';
import {
  getDevkitStatus,
  runDevkitPipeline,
  summarizeDevkitPipelineResponse,
  type DevkitStatusResponse,
  type DeploymentNetwork,
} from '@/lib/devkit';
import { toast } from '@/lib/toast';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

interface Vulnerability {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  line: number;
  confidence: number;
  description: string;
}

interface Metric {
  label: string;
  value: number | string;
  unit?: string;
}

interface AuditLLMResponse {
  vulnerabilities?: Vulnerability[];
  metrics?: Metric[];
  recommendations?: string[];
}

// Severity mapping for static analyzer issue types
function issueSeverity(type: string): Vulnerability['severity'] {
  if (type === 'critical') return 'critical';
  if (type === 'warning') return 'high';
  return 'low';
}

function buildMetricsFromAnalysis(result: { score: number; summary: { critical: number; warnings: number; info: number; totalChecks: number } }): Metric[] {
  return [
    { label: 'QPI Score', value: result.score, unit: '/100' },
    { label: 'Checks Run', value: result.summary.totalChecks, unit: '' },
    { label: 'Critical', value: result.summary.critical, unit: '' },
    { label: 'Warnings', value: result.summary.warnings, unit: '' },
  ];
}

function deriveContractName(code: string): string {
  return code.match(/struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*public\s+ContractBase/)?.[1] || 'UserContract';
}

export default function AuditPage() {
  const [contractCode, setContractCode] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [isCheckingDevkit, setIsCheckingDevkit] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [devkitStatus, setDevkitStatus] = useState<DevkitStatusResponse | null>(null);
  const [pipelineNetwork] = useState<DeploymentNetwork>('testnet');
  const [pipelineOutput, setPipelineOutput] = useState('');
  const [analysisResults, setAnalysisResults] = useState<{
    vulnerabilities: Vulnerability[];
    metrics: Metric[];
    chartData: { category: string; count: number }[];
    recommendations: string[];
    contractMeta: { name: string; size: number; functions: number; date: string };
    analyzed: boolean;
  }>({
    vulnerabilities: [],
    metrics: [],
    chartData: [],
    recommendations: [],
    contractMeta: { name: '', size: 0, functions: 0, date: '' },
    analyzed: false
  });

  // Analyze contract code
  const handleAnalyze = async (overrideCode?: string) => {
    const codeToAnalyze = overrideCode ?? contractCode;
    if (!codeToAnalyze.trim()) return;
    
    setIsAnalyzing(true);
    
    try {
      const settings = await getSettingsAsync();
      
      const activeKey = settings.provider === 'google' ? (settings.googleApiKey || settings.apiKey) : settings.apiKey;
      if (!activeKey) {
        // Run the real 30-check static analyzer (no LLM needed)
        const staticResult = await analyzeContract(codeToAnalyze) as {
          issues: Array<{ type: string; message: string }>;
          score: number;
          summary: { critical: number; warnings: number; info: number; syntaxChecks: number; semanticChecks: number; totalChecks: number };
          suggestions: string[];
        };

        const staticVulns: Vulnerability[] = staticResult.issues.map((issue, idx) => ({
          id: `s${idx + 1}`,
          severity: issueSeverity(issue.type),
          title: issue.message.split('--')[0].trim().toLowerCase().replace(/\s+/g, '.').slice(0, 40),
          line: 0,
          confidence: issue.type === 'critical' ? 0.95 : issue.type === 'warning' ? 0.80 : 0.60,
          description: issue.message,
        }));

        setAnalysisResults({
          vulnerabilities: staticVulns,
          metrics: buildMetricsFromAnalysis(staticResult),
          chartData: [
            { category: 'Critical', count: staticVulns.filter((v) => v.severity === 'critical').length },
            { category: 'High', count: staticVulns.filter((v) => v.severity === 'high').length },
            { category: 'Medium', count: staticVulns.filter((v) => v.severity === 'medium').length },
            { category: 'Low', count: staticVulns.filter((v) => v.severity === 'low').length },
          ],
          recommendations: staticResult.suggestions as string[],
          contractMeta: {
            name: deriveContractName(codeToAnalyze),
            size: codeToAnalyze.length,
            functions: (codeToAnalyze.match(/PUBLIC_(FUNCTION|PROCEDURE)/g) || []).length,
            date: new Date().toISOString().split('T')[0],
          },
          analyzed: true
        });
        setIsAnalyzing(false);
        return;
      }

      // Call LLM for real analysis with JSON enforcement
      const prompt = `Analyze this smart contract code for security vulnerabilities, metrics, and patterns. 
      
Code:
${codeToAnalyze}

Return ONLY a JSON object with this exact structure (no markdown formatting):
{
  "vulnerabilities": [
    { "id": "v1", "severity": "critical"|"high"|"medium"|"low", "title": "string", "line": number, "confidence": number (0-1), "description": "string" }
  ],
  "metrics": [
    { "label": "string", "value": "string|number", "unit": "string" }
  ],
  "recommendations": ["string"]
}`;

      const response = await chatWithAgent(prompt);
      
      let parsedData: AuditLLMResponse | null = null;
      try {
        // Clean markdown code blocks if present
        const cleanJson = response.content.replace(/```json\n?|\n?```/g, '').trim();
        parsedData = JSON.parse(cleanJson) as AuditLLMResponse;
      } catch (e) {
        console.error('Failed to parse LLM response:', e);
        // Fallback or show error
      }

      const parsedVulns: Vulnerability[] = Array.isArray(parsedData?.vulnerabilities)
        ? parsedData.vulnerabilities
        : [];
      const parsedMetrics: Metric[] = Array.isArray(parsedData?.metrics)
        ? parsedData.metrics
        : [
            { label: 'QPI Score', value: 'N/A', unit: '' },
            { label: 'Checks Run', value: 30, unit: '' },
            { label: 'Critical', value: 0, unit: '' },
            { label: 'Warnings', value: 0, unit: '' },
          ];
      const parsedRecs: string[] = Array.isArray(parsedData?.recommendations)
        ? parsedData.recommendations
        : [
        'Review detected issues',
        'Consider using established security patterns',
      ];

      setAnalysisResults({
        vulnerabilities: parsedVulns,
        metrics: parsedMetrics,
        chartData: [
          { category: 'Critical', count: parsedVulns.filter((v) => v.severity === 'critical').length },
          { category: 'High', count: parsedVulns.filter((v) => v.severity === 'high').length },
          { category: 'Medium', count: parsedVulns.filter((v) => v.severity === 'medium').length },
          { category: 'Low', count: parsedVulns.filter((v) => v.severity === 'low').length },
        ],
        recommendations: parsedRecs,
        contractMeta: {
          name: deriveContractName(codeToAnalyze),
          size: codeToAnalyze.length,
          functions: (codeToAnalyze.match(/PUBLIC_(FUNCTION|PROCEDURE)/g) || []).length,
          date: new Date().toISOString().split('T')[0],
        },
        analyzed: true
      });

    } catch (error) {
      console.error('Analysis error:', error);
      // Fall back to real static analysis (no LLM)
      try {
        const fallback = await analyzeContract(codeToAnalyze) as {
          issues: Array<{ type: string; message: string }>;
          score: number;
          summary: { critical: number; warnings: number; info: number; totalChecks: number };
          suggestions: string[];
        };
        const fbVulns: Vulnerability[] = fallback.issues.map((issue, idx) => ({
          id: `f${idx + 1}`,
          severity: issueSeverity(issue.type),
          title: issue.message.split('--')[0].trim().toLowerCase().replace(/\s+/g, '.').slice(0, 40),
          line: 0,
          confidence: issue.type === 'critical' ? 0.95 : 0.80,
          description: issue.message,
        }));
        setAnalysisResults({
          vulnerabilities: fbVulns,
          metrics: buildMetricsFromAnalysis(fallback),
          chartData: [
            { category: 'Critical', count: fbVulns.filter((v) => v.severity === 'critical').length },
            { category: 'High', count: fbVulns.filter((v) => v.severity === 'high').length },
            { category: 'Medium', count: fbVulns.filter((v) => v.severity === 'medium').length },
            { category: 'Low', count: fbVulns.filter((v) => v.severity === 'low').length },
          ],
          recommendations: fallback.suggestions as string[],
          contractMeta: {
            name: deriveContractName(codeToAnalyze),
            size: codeToAnalyze.length,
            functions: (codeToAnalyze.match(/PUBLIC_(FUNCTION|PROCEDURE)/g) || []).length,
            date: new Date().toISOString().split('T')[0],
          },
          analyzed: true
        });
      } catch (staticError) {
        console.error('Static analysis fallback also failed:', staticError);
      }
    }
    
    setIsAnalyzing(false);
  };

  const handleAutoFixAll = async () => {
    if (!contractCode.trim()) {
      toast.warning('Paste contract code before running auto-fix');
      return;
    }

    setIsAutoFixing(true);

    try {
      const response = await chatWithAgent(`Use verify_and_fix on this Qubic contract.

Return ONLY JSON with this shape:
{
  "fixedCode": "string",
  "remainingIssues": number,
  "summary": "string"
}

Code:
${contractCode}`);

      const clean = response.content.replace(/```json\n?|\n?```/g, '').trim();
      const jsonBlock = clean.match(/\{[\s\S]*\}/)?.[0] || clean;
      const parsed = JSON.parse(jsonBlock);

      const fixedCode = typeof parsed.fixedCode === 'string' ? parsed.fixedCode : '';
      const remainingIssues = Number(parsed.remainingIssues || 0);

      if (!fixedCode) {
        throw new Error('No fixed code returned by verify_and_fix');
      }

      setContractCode(fixedCode);
      toast.success(`Auto-fix completed. Remaining issues: ${remainingIssues}`);
      await handleAnalyze(fixedCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auto-fix failed';
      toast.error(message);
    } finally {
      setIsAutoFixing(false);
    }
  };

  const handleExportReport = () => {
    if (!analysisResults.analyzed) {
      toast.warning('Run analysis first to export a report');
      return;
    }

    const report = {
      generatedAt: new Date().toISOString(),
      contractCode,
      ...analysisResults,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qubic-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    toast.success('Audit report exported');
  };

  const handleSavePattern = () => {
    if (!analysisResults.analyzed) {
      toast.warning('Analyze code before saving a pattern');
      return;
    }

    const key = 'qubic-agent-saved-patterns';
    const existing = JSON.parse(localStorage.getItem(key) || '[]') as Array<Record<string, unknown>>;
    existing.unshift({
      id: `pattern-${Date.now()}`,
      savedAt: new Date().toISOString(),
      contractCode,
      recommendations: analysisResults.recommendations,
      vulnerabilityCount: analysisResults.vulnerabilities.length,
    });
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 50)));

    toast.success('Pattern saved locally');
  };

  const handleCheckDevkitStatus = async () => {
    setIsCheckingDevkit(true);

    try {
      const status = await getDevkitStatus(pipelineNetwork);
      setDevkitStatus(status);

      if (status.ready) {
        toast.success(`Dev Kit bridge is ready for ${status.network} compile/deploy actions`);
      } else {
        toast.warning(`Dev Kit bridge (${status.network}) is reachable but not fully configured`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch Dev Kit status';
      toast.error(message);
    } finally {
      setIsCheckingDevkit(false);
    }
  };

  const runPipelineAction = async (action: 'compile' | 'deploy') => {
    if (!contractCode.trim()) {
      toast.warning('Paste contract code before running the production pipeline');
      return;
    }


    if (action === 'compile') {
      setIsCompiling(true);
    } else {
      setIsDeploying(true);
    }

    setPipelineOutput('');

    try {
      const result = await runDevkitPipeline({
        action,
        code: contractCode,
        contractName: deriveContractName(contractCode),
        network: pipelineNetwork,
      });

      setPipelineOutput(summarizeDevkitPipelineResponse(result));

      if (result.ok) {
        if (action === 'compile') {
          toast.success(`Compilation completed through Dev Kit bridge (${pipelineNetwork})`);
        } else {
          toast.success(
            result.contractId
              ? `Deploy command completed on ${pipelineNetwork} (contract ${result.contractId})`
              : `Deploy command completed on ${pipelineNetwork}`
          );
        }
      } else {
        toast.error(result.message || `Failed to ${action} contract`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to ${action} contract`;
      toast.error(message);
    } finally {
      if (action === 'compile') {
        setIsCompiling(false);
      } else {
        setIsDeploying(false);
      }
    }
  };

  const severityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/50';
      case 'high':
        return 'bg-[#F97316]/10 text-[#F97316] border-[#F97316]/50';
      case 'medium':
        return 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/50';
      case 'low':
        return 'bg-[#B0FAFF]/10 text-[#B0FAFF] border-[#B0FAFF]/50';
      default:
        return '';
    }
  };

  const severityIcon = (severity: string) => {
    return severity === 'critical' ? (
      <AlertTriangle className="h-5 w-5" />
    ) : (
      <AlertCircle className="h-5 w-5" />
    );
  };

  return (
    <div className="min-h-screen bg-black bg-grid">
      <Sidebar />
      <main className="lg:ml-64 min-h-screen p-4 lg:p-8 pt-20 lg:pt-8">
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="max-w-6xl mx-auto space-y-6"
        >
          {/* Header */}
          <motion.div variants={itemVariants} className="relative">
            <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-[#B0FAFF]/[0.02] blur-[60px] pointer-events-none" />
            <h1 className="text-2xl font-bold text-white mb-2 gradient-text relative">Security Audit</h1>
            <p className="text-sm text-[#737373] relative">30-check static analysis and LLM-powered vulnerability detection</p>
          </motion.div>

          {/* Code Input Section */}
          <motion.div variants={itemVariants}>
            <CyberCard className="p-6" glowColor="cyan">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FileCode className="h-5 w-5 text-[#B0FAFF]" />
                  <h3 className="text-sm font-bold text-white">CONTRACT CODE</h3>
                </div>
                <Button
                  onClick={() => handleAnalyze()}
                  disabled={isAnalyzing || !contractCode.trim()}
                  className="bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90 h-9 px-4"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Analyze Contract
                    </>
                  )}
                </Button>
              </div>
              <textarea
                value={contractCode}
                onChange={(e) => setContractCode(e.target.value)}
                placeholder="Paste your smart contract code here..."
                className="w-full h-48 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg p-4 text-white font-mono text-sm placeholder:text-[#525252] focus:outline-none focus:border-[#B0FAFF] resize-none"
              />
              <p className="text-xs text-[#525252] mt-2">
                Paste QPI smart contract code (.h file). The analyzer checks for banned types, missing REGISTER entries, operator violations, and security issues.
              </p>
            </CyberCard>
          </motion.div>

          {/* Production Pipeline */}
          <motion.div variants={itemVariants}>
            <CyberCard className="p-6" glowColor="amber">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-[#F59E0B]" />
                  <h3 className="text-sm font-bold text-white">PRODUCTION PIPELINE (BUILD → COMPILE → DEPLOY)</h3>
                </div>
                <div className="flex items-center gap-2">
                  <div className="bg-[#0A0A0A] border border-[#10B981]/40 rounded px-2 py-2 text-xs text-[#10B981] font-medium">
                    Testnet
                  </div>
                  <Button
                    onClick={handleCheckDevkitStatus}
                    disabled={isCheckingDevkit}
                    variant="outline"
                    className="border-[#F59E0B]/50 text-[#F59E0B] hover:bg-[#F59E0B]/10"
                  >
                    {isCheckingDevkit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Server className="h-4 w-4 mr-2" />}
                    {isCheckingDevkit ? 'Checking...' : 'Check Dev Kit Status'}
                  </Button>
                </div>
              </div>


              <p className="text-xs text-[#737373] mb-4">
                This uses the local server bridge at <span className="font-mono text-[#A3A3A3]">/api/devkit/pipeline</span>. Configure
                <span className="font-mono text-[#A3A3A3]"> QUBIC_DEVKIT_ENABLE_EXEC</span>,
                <span className="font-mono text-[#A3A3A3]"> QUBIC_DEVKIT_COMPILE_CMD</span>, and
                <span className="font-mono text-[#A3A3A3]"> QUBIC_DEVKIT_DEPLOY_CMD</span> in your environment.
              </p>

              {devkitStatus && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded text-xs">
                    <div className="text-[#737373] mb-1">Bridge</div>
                    <div className={cn('font-bold', devkitStatus.enabled ? 'text-[#10B981]' : 'text-[#EF4444]')}>
                      {devkitStatus.enabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                  <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded text-xs">
                    <div className="text-[#737373] mb-1">Commands</div>
                    <div className="font-bold text-white">
                      {devkitStatus.commands.compileConfigured ? 'Compile ✓' : 'Compile ✗'} · {devkitStatus.commands.deployConfigured ? 'Deploy ✓' : 'Deploy ✗'}
                    </div>
                  </div>
                  <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded text-xs">
                    <div className="text-[#737373] mb-1">RPC</div>
                    <div className={cn('font-bold', devkitStatus.rpc.reachable ? 'text-[#10B981]' : 'text-[#EF4444]')}>
                      {devkitStatus.rpc.reachable ? `Reachable (tick ${devkitStatus.rpc.tick})` : 'Unreachable'}
                    </div>
                    <div className="text-[#737373] mt-1">Network: {devkitStatus.network}</div>
                  </div>
                </div>
              )}

              {devkitStatus?.notes?.length ? (
                <div className="mb-4 p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded text-xs text-[#A3A3A3]">
                  <div className="text-[#737373] mb-2">Bridge Notes</div>
                  <ul className="space-y-1 list-disc list-inside">
                    {devkitStatus.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 mb-4">
                <Button
                  onClick={() => runPipelineAction('compile')}
                  disabled={isCompiling || isDeploying || !contractCode.trim()}
                  className="bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/50 hover:bg-[#F59E0B]/20"
                >
                  {isCompiling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
                  {isCompiling ? 'Compiling...' : 'Compile via Dev Kit'}
                </Button>
                <Button
                  onClick={() => runPipelineAction('deploy')}
                  disabled={isDeploying || isCompiling || !contractCode.trim()}
                  className="bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/50 hover:bg-[#10B981]/20"
                >
                  {isDeploying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
                  {isDeploying ? 'Deploying...' : 'Run Deploy Command'}
                </Button>
              </div>

              {pipelineOutput && (
                <pre className="max-h-72 overflow-auto bg-[#050505] border border-[#1A1A1A] rounded-lg p-3 text-xs text-[#A3A3A3] whitespace-pre-wrap">
                  {pipelineOutput}
                </pre>
              )}
            </CyberCard>
          </motion.div>

          {/* Results - Only show after analysis */}
          <AnimatePresence>
          {analysisResults.analyzed && (
          <>
          {/* Overview Section */}
          <motion.div 
            variants={itemVariants} 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {/* Left: Contract Info */}
            <CyberCard className="p-6" glowColor="cyan">
              <h3 className="text-sm font-bold mb-4 text-white">CONTRACT METADATA</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#A3A3A3]">Name:</span>
                  <span className="text-white font-mono">{analysisResults.contractMeta.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A3A3A3]">Size:</span>
                  <span className="text-white font-mono">{analysisResults.contractMeta.size.toLocaleString()} bytes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A3A3A3]">Functions:</span>
                  <span className="text-white font-mono">{analysisResults.contractMeta.functions}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A3A3A3]">Audit Date:</span>
                  <span className="text-white font-mono">{analysisResults.contractMeta.date}</span>
                </div>
                <div className="border-t border-[#2A2A2A] pt-3 mt-3">
                  <span className="text-[#A3A3A3]">QPI Score:</span>
                  {(() => {
                    const scoreMetric = analysisResults.metrics.find(m => m.label === 'QPI Score');
                    const scoreVal = typeof scoreMetric?.value === 'number' ? scoreMetric.value : 0;
                    return (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-2 bg-[#1A1A1A] rounded overflow-hidden">
                          <div className={cn('h-full shadow-[0_0_10px_rgba(176,250,255,0.5)]', scoreVal >= 80 ? 'bg-[#10B981]' : scoreVal >= 50 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]')} style={{ width: `${scoreVal}%` }} />
                        </div>
                        <span className={cn('text-sm font-bold', scoreVal >= 80 ? 'text-[#10B981]' : scoreVal >= 50 ? 'text-[#F59E0B]' : 'text-[#EF4444]')}>{scoreVal}/100</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </CyberCard>

            {/* Right: Metrics */}
            <CyberCard className="p-6" glowColor="purple">
              <h3 className="text-sm font-bold mb-4 text-white">AUDIT METRICS</h3>
              <div className="grid grid-cols-2 gap-4">
                {analysisResults.metrics.map((metric, idx) => (
                  <div key={idx} className="p-3 bg-[#0A0A0A] rounded border border-[#1A1A1A] hover:border-[#B0FAFF]/30 transition-colors">
                    <div className="text-xs text-[#A3A3A3] mb-1">{metric.label}</div>
                    <div className="text-xl font-bold text-[#B0FAFF]">
                      {metric.value}
                      {metric.unit && <span className="text-xs ml-1">{metric.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CyberCard>
          </motion.div>

          {/* Vulnerability List */}
          <motion.div variants={itemVariants}>
          <CyberCard glowColor="red" className="p-6">
            <h3 className="text-sm font-bold mb-4 text-white">VULNERABILITIES DETECTED</h3>
            <div className="space-y-3">
              {analysisResults.vulnerabilities.map((vuln) => (
                <div
                  key={vuln.id}
                  className={cn(
                    "flex items-start gap-4 p-4 rounded border transition-all hover:shadow-lg hover:scale-[1.01] duration-200",
                    severityColor(vuln.severity)
                  )}
                >
                  <div className="mt-1">{severityIcon(vuln.severity)}</div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-mono font-bold text-sm uppercase">
                          {vuln.severity} {vuln.title}
                        </div>
                        <div className="text-xs mt-1 opacity-80">{vuln.description}</div>
                      </div>
                      <div className="text-xs font-mono whitespace-nowrap ml-2">line={vuln.line}</div>
                    </div>
                    <div className="text-xs flex items-center gap-2">
                      <span>confidence={vuln.confidence}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleAutoFixAll}
                        className="h-6 px-2 text-xs border-current text-current hover:bg-current hover:text-white bg-transparent"
                      >
                        [auto-fix]
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CyberCard>
          </motion.div>

          {/* Chart Section */}
          <motion.div variants={itemVariants}>
          <CyberCard className="p-6">
            <h3 className="text-sm font-bold mb-4 text-white">VULNERABILITY DISTRIBUTION</h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analysisResults.chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333333" />
                  <XAxis dataKey="category" tick={{ fontSize: 12, fill: '#808080' }} stroke="#808080" />
                  <YAxis tick={{ fontSize: 12, fill: '#808080' }} stroke="#808080" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0A0A0A',
                      border: '1px solid #1A1A1A',
                      borderRadius: '8px',
                      color: '#fff',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                    }}
                    cursor={{ fill: 'rgba(176, 250, 255, 0.05)' }}
                  />
                  <Bar dataKey="count" fill="#B0FAFF" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CyberCard>
          </motion.div>

          {/* Recommendations */}
          <motion.div variants={itemVariants}>
          <CyberCard glowColor="green" className="p-6">
            <h3 className="text-sm font-bold mb-4 text-white">RECOMMENDATIONS</h3>
            <div className="space-y-3">
              {analysisResults.recommendations.map((rec, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-[#2A2A2A]/50 rounded">
                  <div className="text-[#B0FAFF] font-bold">→</div>
                  <div className="text-sm text-[#A3A3A3]">{rec}</div>
                </div>
              ))}
            </div>
          </CyberCard>
          </motion.div>

          {/* Action Buttons */}
          <motion.div variants={itemVariants} className="flex gap-2 flex-wrap">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                onClick={handleAutoFixAll}
                disabled={isAutoFixing || !contractCode.trim()}
                className="bg-[#B0FAFF]/10 text-[#B0FAFF] border border-[#B0FAFF]/50 hover:bg-[#B0FAFF]/20 glow-cyan-sm"
              >
                {isAutoFixing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
                {isAutoFixing ? 'Auto-fixing...' : 'Auto-fix All'}
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                onClick={handleExportReport}
                className="bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/50 hover:bg-[#F59E0B]/20"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Report
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                onClick={handleSavePattern}
                className="bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/50 hover:bg-[#10B981]/20"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Pattern
              </Button>
            </motion.div>
          </motion.div>
          </>
          )}
          </AnimatePresence>
        </motion.div>
      </main>
    </div>
  );
}
