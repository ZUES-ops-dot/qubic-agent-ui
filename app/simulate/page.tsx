'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from '@/components/sidebar'
import { CyberCard } from '@/components/ui/cyber-card';
import { Button } from '@/components/ui/button';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from 'recharts';
import { Plus, Trash2, Play, Users, RotateCw, Gauge, Clock, CheckCircle, AlertTriangle, Zap, Code, FileCode } from 'lucide-react';
import { cn } from '@/lib/utils';
import { runSimulation, deployContract, getTestnetStatus, type TestnetStatus, type DeploymentResult } from '@/lib/testnet';
import type { DeploymentNetwork } from '@/lib/devkit';
import { getPendingSimulationContract, clearPendingSimulationContract } from '@/lib/storage';
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

interface SimulatedUser {
  id: string;
  name: string;
  type: 'novice' | 'intermediate' | 'expert' | 'malicious';
  actions: number;
}

interface TestScenario {
  id: string;
  name: string;
  description: string;
  userCount: number;
  duration: string;
  enabled: boolean;
}

interface SimulationResult {
  metric: string;
  score: number;
  status: 'pass' | 'warning' | 'fail';
  details: string;
}

interface ContractContext {
  name: string;
  type: string;
  description: string;
  functions: string[];
}

interface SearchParamsLike {
  get: (name: string) => string | null;
}

function parseQPIFunctions(code: string): string[] {
  const matches = code.match(/(?:PUBLIC|PRIVATE)_(?:FUNCTION|PROCEDURE)(?:_WITH_LOCALS)?\(([^)]+)\)/g) || [];
  return matches.map(m => m.match(/\(([^)]+)\)/)?.[1] || '').filter(Boolean);
}

function getContractContextFromParams(searchParams: SearchParamsLike): ContractContext | null {
  const contractName = searchParams.get('contract');
  const contractType = searchParams.get('type');
  const contractDesc = searchParams.get('desc');

  if (!contractName) {
    return null;
  }

  return {
    name: contractName,
    type: contractType || 'smart-contract',
    description: contractDesc || 'LLM-generated Qubic smart contract',
    functions: [],
  };
}

function buildTestScenarios(context: ContractContext): TestScenario[] {
  return [
    {
      id: '1',
      name: 'Basic Operations',
      description: `Test core ${context.type} functionality`,
      userCount: 10,
      duration: '2s',
      enabled: true,
    },
    {
      id: '2',
      name: 'Concurrent Access',
      description: 'Multiple users accessing simultaneously',
      userCount: 50,
      duration: '4s',
      enabled: true,
    },
    {
      id: '3',
      name: 'Edge Cases',
      description: 'Boundary conditions and error handling',
      userCount: 20,
      duration: '3s',
      enabled: true,
    },
  ];
}

function buildInitialUsers(): SimulatedUser[] {
  const types: SimulatedUser['type'][] = ['novice', 'intermediate', 'expert'];
  return types.map((type, idx) => ({
    id: String(idx + 1),
    name: `User ${String.fromCharCode(65 + idx)}`,
    type,
    actions: 0,
  }));
}

function extractContractName(code: string): string {
  return code.match(/struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*public\s+ContractBase/)?.[1] || 'UserContract';
}

function SimulatePageScreen({ searchParams }: { searchParams: SearchParamsLike }) {
  const initialContractContext = getContractContextFromParams(searchParams);
  const launchedFromChat = searchParams.get('from') === 'chat';
  const [pendingContract] = useState(() => getPendingSimulationContract());
  const [contractCode, setContractCode] = useState(() => pendingContract?.code || '');

  const inferredContractName = extractContractName(contractCode);
  const contractName = inferredContractName !== 'UserContract'
    ? inferredContractName
    : pendingContract?.name || initialContractContext?.name || 'UserContract';

  const contractContext: ContractContext | null = contractCode.trim()
    ? {
        name: contractName,
        type: pendingContract?.type || initialContractContext?.type || 'qpi-contract',
        description: pendingContract?.description || initialContractContext?.description || 'LLM-generated Qubic smart contract',
        functions: parseQPIFunctions(contractCode),
      }
    : initialContractContext;
  
  // Dynamic state - starts empty, populated based on contract or user actions
  const [simulatedUsers, setSimulatedUsers] = useState<SimulatedUser[]>(
    () => ((pendingContract?.code?.trim() || initialContractContext) ? buildInitialUsers() : [])
  );
  const testScenarios = contractContext ? buildTestScenarios(contractContext) : [];
  const [simulationResults, setSimulationResults] = useState<SimulationResult[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [stressTestMode, setStressTestMode] = useState(false);
  const [deploymentNetwork] = useState<DeploymentNetwork>('testnet');
  const [testnetStatus, setTestnetStatus] = useState<TestnetStatus | null>(null);
  const [deploymentResult, setDeploymentResult] = useState<DeploymentResult | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  const generateInitialUsers = () => {
    setSimulatedUsers(buildInitialUsers());
  };

  // Fetch testnet status on mount
  useEffect(() => {
    getTestnetStatus(deploymentNetwork).then(setTestnetStatus).catch(console.error);
  }, [deploymentNetwork]);

  useEffect(() => {
    if (pendingContract?.code?.trim()) {
      clearPendingSimulationContract();
      return;
    }

    if (launchedFromChat) {
      toast.warning('No pending contract code found. Open simulation from a chat message with generated QPI code.');
    }
  }, [launchedFromChat, pendingContract]);

  const handleSimulate = async () => {
    const codeToDeploy = contractCode.trim();
    if (!codeToDeploy) {
      toast.warning('No contract source code loaded. Generate a contract in Chat and click Simulate again.');
      return;
    }

    setIsSimulating(true);
    setSimulationResults([]);
    setSimulationError(null);
    setDeploymentResult(null);

    try {
      // 1. Deploy contract via Dev Kit bridge
      const deployment = await deployContract(codeToDeploy, deploymentNetwork);
      setDeploymentResult(deployment);

      if (deployment.source !== 'devkit') {
        toast.warning(`Dev Kit bridge not configured for ${deployment.network}. Running in local mode.`);
      }
      
      // 2. Run simulation with real static analysis
      const metrics = await runSimulation(
        deployment.id,
        {
          userCount: simulatedUsers.length,
          duration: 5,
          stressTest: stressTestMode,
          network: deployment.network,
        },
        () => {
          setSimulatedUsers((prev) =>
            prev.map((user) => ({
              ...user,
              actions: user.actions + Math.floor(Math.random() * 5),
            }))
          );
        },
        codeToDeploy
      );

      // 3. Generate results from real analysis metrics
      const securityScore = Math.max(0, 100 - metrics.errors * 10);
      const clarityScore = codeToDeploy.includes('INITIALIZE') && codeToDeploy.includes('using namespace QPI') ? 92 : 68;

      const results: SimulationResult[] = [
        { 
          metric: 'Usability Score', 
          score: Math.min(100, Math.floor(metrics.successRate)), 
          status: metrics.successRate > 95 ? 'pass' : 'warning', 
          details: `Success rate: ${metrics.successRate}% across ${simulatedUsers.length} users` 
        },
        { 
          metric: 'Execution Speed', 
          score: metrics.tps > 1000 ? 98 : 85, 
          status: 'pass', 
          details: `Peak TPS: ${Math.floor(metrics.tps)} (Qubic instant finality)` 
        },
        { 
          metric: 'Error Handling', 
          score: Math.max(0, 100 - metrics.errors * 5), 
          status: metrics.errors === 0 ? 'pass' : 'warning', 
          details: `${metrics.errors} QPI violations detected by static analysis` 
        },
        { 
          metric: 'Code Clarity', 
          score: clarityScore, 
          status: clarityScore >= 80 ? 'pass' : 'warning', 
          details: clarityScore >= 80 ? 'Contract follows QPI structure conventions' : 'Missing QPI boilerplate (INITIALIZE, namespace, etc.)' 
        },
        { 
          metric: 'Security', 
          score: securityScore, 
          status: securityScore >= 80 ? 'pass' : securityScore >= 50 ? 'warning' : 'fail', 
          details: metrics.errors === 0 ? 'No QPI violations detected' : `${metrics.errors} violation(s) -- banned types, operators, or structural issues` 
        },
      ];

      setSimulationResults(results);
    } catch (error) {
      console.error('Simulation failed:', error);
      const message = error instanceof Error ? error.message : 'Simulation failed';
      setSimulationError(message);
      toast.error(message);
    }
    
    setIsSimulating(false);
  };

  const handleAddUser = () => {
    const types: SimulatedUser['type'][] = ['novice', 'intermediate', 'expert', 'malicious'];
    setSimulatedUsers([
      ...simulatedUsers,
      {
        id: String(Date.now()),
        name: `User ${String.fromCharCode(65 + simulatedUsers.length)}`,
        type: types[Math.floor(Math.random() * types.length)],
        actions: 0,
      },
    ]);
  };

  const handleDeleteUser = (id: string) => {
    setSimulatedUsers(simulatedUsers.filter((u) => u.id !== id));
  };

  const getUserTypeColor = (type: SimulatedUser['type']) => {
    switch (type) {
      case 'novice': return 'text-[#10B981]';
      case 'intermediate': return 'text-[#B0FAFF]';
      case 'expert': return 'text-[#F59E0B]';
      case 'malicious': return 'text-[#EF4444]';
    }
  };

  const radarData = simulationResults.map((r) => ({
    metric: r.metric.split(' ')[0],
    score: r.score,
    fullMark: 100,
  }));

  const preferredNetworkMismatch = Boolean(
    testnetStatus
    && testnetStatus.online
    && testnetStatus.rpcSource !== 'offline'
    && testnetStatus.rpcSource !== deploymentNetwork
  );

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
            <h1 className="text-2xl font-bold text-white mb-2 gradient-text relative">Contract Simulator</h1>
            <p className="text-sm text-[#737373] relative">Deploy and test QPI smart contracts against simulated user scenarios</p>
          </motion.div>

          {/* Contract Context - shown when navigating from chat */}
          {contractContext && (
            <motion.div variants={itemVariants}>
              <CyberCard glowColor="purple" className="p-4" hover={false}>
                <div className="flex items-center gap-3">
                  <FileCode className="h-5 w-5 text-purple-400" />
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white">{contractContext.name}</div>
                    <div className="text-xs text-[#737373]">{contractContext.description}</div>
                    <div className={cn('text-[11px] mt-1', contractCode ? 'text-[#10B981]' : 'text-[#F59E0B]')}>
                      {contractCode ? `Source loaded (${contractCode.length.toLocaleString()} chars)` : 'Source code unavailable'}
                    </div>
                  </div>
                  <div className="text-xs text-purple-400 bg-purple-500/10 px-2 py-1 rounded">
                    {contractContext.type}
                  </div>
                </div>
              </CyberCard>
            </motion.div>
          )}

          <motion.div variants={itemVariants}>
            <CyberCard className="p-4" glowColor="cyan" hover={false}>
              <h3 className="text-sm font-bold mb-3 text-white">CONTRACT SOURCE</h3>
              <textarea
                value={contractCode}
                onChange={(e) => setContractCode(e.target.value)}
                placeholder="Paste QPI contract code here to enable deploy-backed simulation..."
                className="w-full h-40 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg p-3 text-white font-mono text-xs placeholder:text-[#525252] focus:outline-none focus:border-[#B0FAFF] resize-none"
              />
              <p className="text-[11px] text-[#737373] mt-2">
                Deployment pipeline uses this source directly. You can edit/paste code here if chat handoff data is missing.
              </p>
            </CyberCard>
          </motion.div>

          {/* Empty State - when no contract loaded */}
          {!contractContext && simulatedUsers.length === 0 && !contractCode.trim() && (
            <motion.div variants={itemVariants}>
              <CyberCard className="p-8 text-center" hover={false}>
                <Code className="h-12 w-12 text-[#737373] mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-2">No Contract Loaded</h3>
                <p className="text-sm text-[#737373] mb-4">
                  Generate a smart contract from Chat, or add simulated users to begin testing.
                </p>
                <Button
                  onClick={generateInitialUsers}
                  className="bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Start Fresh Simulation
                </Button>
              </CyberCard>
            </motion.div>
          )}

          {/* Mode Toggle */}
          <motion.div variants={itemVariants} className="flex gap-3">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              variant="outline"
              className={cn(
                "border-[#1A1A1A] text-xs hover:bg-[#1A1A1A] hover:text-white",
                !stressTestMode ? "bg-[#B0FAFF]/10 text-[#B0FAFF] border-[#B0FAFF]/50" : "text-[#737373]"
              )}
              onClick={() => setStressTestMode(false)}
            >
              <Users className="h-3 w-3 mr-1" />
              STANDARD TEST
            </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              variant="outline"
              className={cn(
                "border-[#1A1A1A] text-xs hover:bg-[#1A1A1A] hover:text-white",
                stressTestMode ? "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/50" : "text-[#737373]"
              )}
              onClick={() => setStressTestMode(true)}
            >
              <Zap className="h-3 w-3 mr-1" />
              STRESS TEST
            </Button>
            </motion.div>
          </motion.div>

          <motion.div variants={itemVariants} className="max-w-xs">
            <label className="text-xs text-[#A3A3A3] block mb-2">Deploy target network</label>
            <div className="w-full bg-[#0A0A0A] border border-[#10B981]/30 rounded-lg px-3 py-2 text-sm text-[#10B981] font-medium">
              Testnet
            </div>
            <p className="text-[11px] text-[#737373] mt-2">
              Mainnet deployment requires computor voting + IPO.
            </p>
          </motion.div>

          <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Simulated Users */}
            <div className="space-y-4">
              <CyberCard className="p-4" hover={false}>
                <h3 className="text-sm font-bold mb-4 text-white">SIMULATED USERS</h3>
                <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                  {simulatedUsers.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-3 bg-[#0A0A0A] rounded border border-[#1A1A1A] text-xs"
                    >
                      <div>
                        <div className="font-bold text-white">{user.name}</div>
                        <div className={cn("text-xs", getUserTypeColor(user.type))}>{user.type}</div>
                        {user.actions > 0 && (
                          <div className="text-[#737373] text-xs mt-1">{user.actions} actions</div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-[#EF4444] hover:bg-[#EF4444]/10 hover:text-[#EF4444]"
                        onClick={() => handleDeleteUser(user.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={handleAddUser}
                  className="w-full bg-[#B0FAFF]/10 text-[#B0FAFF] border border-[#B0FAFF]/50 hover:bg-[#B0FAFF]/20 text-xs h-8"
                >
                  <Plus className="h-3 w-3 mr-1" /> ADD USER
                </Button>
              </CyberCard>
            </div>

            {/* Middle: Test Scenarios */}
            <div className="space-y-4">
              <CyberCard className="p-4" hover={false}>
                <h3 className="text-sm font-bold mb-4 text-white">TEST SCENARIOS</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                  {testScenarios.map((scenario) => (
                    <div
                      key={scenario.id}
                      className="p-3 bg-[#0A0A0A] rounded border border-[#1A1A1A] text-xs space-y-1"
                    >
                      <div className="font-bold text-[#B0FAFF]">{scenario.name}</div>
                      <div className="text-[#737373]">{scenario.description}</div>
                      <div className="flex justify-between text-[#737373] border-t border-[#1A1A1A] pt-1 mt-1">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> {scenario.userCount}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {scenario.duration}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CyberCard>

              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                onClick={handleSimulate}
                disabled={isSimulating || simulatedUsers.length === 0 || !contractCode.trim()}
                className="w-full bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90 disabled:opacity-50 text-xs h-10 font-bold"
              >
                {isSimulating ? (
                  <RotateCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                {isSimulating ? 'SIMULATING...' : 'RUN SIMULATION'}
              </Button>
              {!contractCode.trim() && (
                <p className="text-[11px] text-[#F59E0B] mt-2">
                  Load contract code from Chat to enable deploy-backed simulation.
                </p>
              )}
              </motion.div>
            </div>

            {/* Right: Quick Metrics */}
            <div className="space-y-4">
              <CyberCard glowColor="cyan" className="p-4" hover={false}>
                <h3 className="text-sm font-bold mb-4 text-white">NETWORK STATUS</h3>
                <div className="space-y-3 text-xs">
                  <div className="flex items-center gap-3 p-2 bg-[#0A0A0A] rounded border border-[#1A1A1A]">
                    <div className={cn(
                      'w-2 h-2 rounded-full flex-shrink-0',
                      testnetStatus?.online ? 'bg-[#10B981] animate-pulse' : 'bg-[#EF4444]'
                    )} />
                    <div className="flex-1">
                      <div className="text-white font-bold">
                        {testnetStatus?.online ? `Connected (${testnetStatus.rpcSource})` : 'Offline'}
                      </div>
                      <div className="text-[#737373]">
                        {testnetStatus?.online
                          ? `Target ${deploymentNetwork} · Epoch ${testnetStatus.epoch} · Tick ${testnetStatus.blockHeight.toLocaleString()}`
                          : `Target ${deploymentNetwork} · Local mode`}
                      </div>
                      {preferredNetworkMismatch && (
                        <div className="text-[11px] text-[#F59E0B] mt-1">
                          Preferred network unavailable; displaying fallback RPC status from {testnetStatus?.rpcSource}.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2 bg-[#0A0A0A] rounded border border-[#1A1A1A]">
                    <Zap className="h-4 w-4 text-[#B0FAFF]" />
                    <div>
                      <div className="text-white font-bold">Gasless</div>
                      <div className="text-[#737373]">No transaction fees</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2 bg-[#0A0A0A] rounded border border-[#1A1A1A]">
                    <Clock className="h-4 w-4 text-[#10B981]" />
                    <div>
                      <div className="text-white font-bold">Instant Finality</div>
                      <div className="text-[#737373]">Sub-second confirmation</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2 bg-[#0A0A0A] rounded border border-[#1A1A1A]">
                    <Gauge className="h-4 w-4 text-[#F59E0B]" />
                    <div>
                      <div className="text-white font-bold">High Throughput</div>
                      <div className="text-[#737373]">15.5M+ TPS capacity</div>
                    </div>
                  </div>
                </div>
              </CyberCard>

              {deploymentResult && (
                <CyberCard glowColor="amber" className="p-4" hover={false}>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="text-sm font-bold text-white">LATEST DEPLOYMENT</h3>
                    <span
                      className={cn(
                        'text-[10px] uppercase tracking-wide px-2 py-1 rounded border',
                        deploymentResult.source === 'devkit'
                          ? 'text-[#10B981] border-[#10B981]/40 bg-[#10B981]/10'
                          : 'text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/10'
                      )}
                    >
                      {deploymentResult.source === 'devkit' ? 'Dev Kit' : 'Local'}
                    </span>
                  </div>
                  <div className="space-y-3 text-xs">
                    <div>
                      <div className="text-[#737373] mb-1">Contract ID</div>
                      <div className="font-mono text-[#F59E0B] break-all">{deploymentResult.id}</div>
                    </div>
                    <div>
                      <div className="text-[#737373] mb-1">Transaction Hash</div>
                      <div className="font-mono text-[#A3A3A3] break-all">{deploymentResult.hash}</div>
                    </div>
                    <div>
                      <div className="text-[#737373] mb-1">Target Network</div>
                      <div className="font-mono text-white">{deploymentResult.network}</div>
                    </div>
                    <div>
                      <div className="text-[#737373] mb-1">Pipeline Notes</div>
                      <pre className="bg-[#0A0A0A] border border-[#1A1A1A] rounded p-2 text-[11px] text-[#A3A3A3] whitespace-pre-wrap max-h-36 overflow-auto">
                        {deploymentResult.note}
                      </pre>
                    </div>
                  </div>
                </CyberCard>
              )}

              {simulationError && (
                <CyberCard glowColor="red" className="p-4" hover={false}>
                  <h3 className="text-sm font-bold mb-2 text-[#EF4444]">SIMULATION ERROR</h3>
                  <p className="text-xs text-[#A3A3A3]">{simulationError}</p>
                </CyberCard>
              )}
            </div>
          </motion.div>

          {/* Simulation Results */}
          <AnimatePresence>
          {simulationResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
            <CyberCard glowColor="green" className="p-6">
              <h3 className="text-sm font-bold mb-4 text-white">SIMULATION RESULTS</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {simulationResults.map((result, idx) => (
                  <div key={idx} className="p-4 bg-[#0A0A0A] rounded border border-[#1A1A1A] text-center">
                    <div className={cn(
                      "text-2xl font-bold mb-1",
                      result.status === 'pass' ? 'text-[#10B981]' : result.status === 'warning' ? 'text-[#F59E0B]' : 'text-[#EF4444]'
                    )}>
                      {result.score}%
                    </div>
                    <div className="text-xs text-white font-bold mb-1">{result.metric}</div>
                    <div className="flex items-center justify-center gap-1">
                      {result.status === 'pass' ? (
                        <CheckCircle className="h-3 w-3 text-[#10B981]" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 text-[#F59E0B]" />
                      )}
                      <span className={cn(
                        "text-xs",
                        result.status === 'pass' ? 'text-[#10B981]' : 'text-[#F59E0B]'
                      )}>
                        {result.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CyberCard>
            </motion.div>
          )}
          </AnimatePresence>

          {/* Radar Chart */}
          <AnimatePresence>
          {simulationResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
            <CyberCard className="p-6">
              <h3 className="text-sm font-bold mb-4 text-white">QUALITY ANALYSIS</h3>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#1A1A1A" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#737373' }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10, fill: '#737373' }} />
                    <Radar name="Score" dataKey="score" stroke="#B0FAFF" fill="#B0FAFF" fillOpacity={0.3} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CyberCard>
            </motion.div>
          )}
          </AnimatePresence>

          {/* Stress Test Mode Info */}
          <AnimatePresence>
          {stressTestMode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
            <CyberCard glowColor="amber" className="p-6">
              <h3 className="text-sm font-bold mb-4 text-[#F59E0B]">STRESS TEST MODE</h3>
              <div className="text-xs text-[#737373] space-y-2">
                <p>Stress testing simulates extreme conditions to find breaking points in LLM-generated code:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>High concurrent user load (1000+ simultaneous users)</li>
                  <li>Rapid sequential operations</li>
                  <li>Edge case inputs and boundary conditions</li>
                  <li>Malicious user behavior patterns</li>
                </ul>
              </div>
            </CyberCard>
            </motion.div>
          )}
          </AnimatePresence>
        </motion.div>
      </main>
    </div>
  );
}

function SimulatePageContent() {
  const searchParams = useSearchParams();
  return <SimulatePageScreen key={searchParams.toString()} searchParams={searchParams} />;
}

// Default export with Suspense wrapper for useSearchParams
export default function SimulatePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-[#B0FAFF] animate-pulse">Loading...</div>
      </div>
    }>
      <SimulatePageContent />
    </Suspense>
  );
}
