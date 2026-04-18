// Central type definitions for Qubic Agent UI

// Chat types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  status?: 'thinking' | 'generating' | 'complete' | 'error';
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

// Settings types
export interface Settings {
  apiKey: string;
  googleApiKey: string;
  provider: 'openai' | 'google';
  model: string;
  autoValidate: boolean;
  showConfidence: boolean;
  oracleToolkitUrl: string;
  oracleToolkitToken: string;
  devkitBridgeToken: string;
  preferredDeploymentNetwork: 'testnet' | 'mainnet';
}

// RAG types
export interface RAGDocument {
  id: string;
  title: string;
  content: string;
  source: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
}

export interface ContractPattern {
  id: string;
  name: string;
  type: 'security' | 'optimization' | 'architecture' | 'math';
  description: string;
  code: string;
  source: string;
  // UI extended fields
  confidence?: number;
  applied?: number;
  total?: number;
  preconditions?: string[];
  evidence?: string;
}

export interface Vulnerability {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  line?: number;
  code?: string;
  fix?: string;
  confidence: number;
}

// Audit types
export interface AuditResult {
  contractName: string;
  contractSize: number;
  functionCount: number;
  vulnerabilities: Vulnerability[];
  score: number;
  recommendations: string[];
  analyzedAt: string;
}

// Simulation types
export interface SimulatedUser {
  id: string;
  name: string;
  type: 'novice' | 'intermediate' | 'expert' | 'malicious';
  actions: number;
}

export interface TestScenario {
  id: string;
  name: string;
  description: string;
  userCount: number;
  duration: string;
  enabled: boolean;
}

export interface SimulationResult {
  metric: string;
  score: number;
  status: 'pass' | 'warning' | 'fail';
  details: string;
}

// API response types
export interface APIResponse<T> {
  data?: T;
  error?: string;
  status: 'success' | 'error';
}

export interface ChatResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
