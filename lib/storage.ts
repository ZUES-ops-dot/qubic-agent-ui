// localStorage wrapper for persistent storage with encryption

import { encryptApiKey, decryptApiKey, encryptStoredSecret, decryptStoredSecret, decryptApiKeyAsync, decryptStoredSecretAsync, isEncrypted } from './crypto';

const STORAGE_KEYS = {
  API_KEY: 'qubic-agent-api-key',
  MODEL: 'qubic-agent-model',
  SETTINGS: 'qubic-agent-settings',
  CHAT_HISTORY: 'qubic-agent-history',
  CURRENT_CHAT: 'qubic-agent-current-chat',
  PENDING_SIMULATION: 'qubic-agent-pending-simulation',
} as const;

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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface PendingSimulationContract {
  name: string;
  type: string;
  description: string;
  code: string;
  network?: 'testnet' | 'mainnet';
  createdAt: string;
  sourceMessageId?: string;
}

const defaultSettings: Settings = {
  apiKey: '',
  googleApiKey: '',
  provider: 'google',
  model: 'gemini-2.5-flash',
  autoValidate: true,
  showConfidence: true,
  oracleToolkitUrl: 'http://127.0.0.1:5060',
  oracleToolkitToken: '',
  devkitBridgeToken: '',
  preferredDeploymentNetwork: 'testnet',
};

// Check if we're in browser
const isBrowser = typeof window !== 'undefined';

// Settings
export function getSettings(): Settings {
  if (!isBrowser) return defaultSettings;
  
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Decrypt API key if encrypted
      if (parsed.apiKey && isEncrypted(parsed.apiKey)) {
        parsed.apiKey = decryptApiKey(parsed.apiKey);
      }

      // Decrypt Google API key if encrypted
      if (parsed.googleApiKey && isEncrypted(parsed.googleApiKey)) {
        parsed.googleApiKey = decryptApiKey(parsed.googleApiKey);
      }

      // Validate provider field
      if (parsed.provider !== 'openai' && parsed.provider !== 'google') {
        parsed.provider = 'google';
      }

      // Decrypt optional local secrets (supports plaintext legacy values)
      if (typeof parsed.oracleToolkitToken === 'string') {
        parsed.oracleToolkitToken = decryptStoredSecret(parsed.oracleToolkitToken);
      }
      if (typeof parsed.devkitBridgeToken === 'string') {
        parsed.devkitBridgeToken = decryptStoredSecret(parsed.devkitBridgeToken);
      }

      if (parsed.preferredDeploymentNetwork !== 'mainnet') {
        parsed.preferredDeploymentNetwork = 'testnet';
      }

      return { ...defaultSettings, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return defaultSettings;
}

export function saveSettings(settings: Partial<Settings>): void {
  if (!isBrowser) return;
  
  try {
    let rawCurrent: Partial<Settings> = {};
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (stored) {
      try {
        rawCurrent = JSON.parse(stored) as Partial<Settings>;
      } catch {
        rawCurrent = {};
      }
    }
    const current = getSettings();
    const updated: Settings = { ...current, ...settings };

    const preserveEncrypted = (field: keyof Pick<Settings, 'apiKey' | 'googleApiKey' | 'oracleToolkitToken' | 'devkitBridgeToken'>) => {
      const explicitlyUpdated = Object.prototype.hasOwnProperty.call(settings, field);
      const rawValue = rawCurrent[field];
      if (!explicitlyUpdated && typeof rawValue === 'string' && isEncrypted(rawValue)) {
        updated[field] = rawValue;
      }
    };

    preserveEncrypted('apiKey');
    preserveEncrypted('googleApiKey');
    preserveEncrypted('oracleToolkitToken');
    preserveEncrypted('devkitBridgeToken');
    
    // Encrypt API keys before storing
    if (updated.apiKey) {
      updated.apiKey = encryptApiKey(updated.apiKey);
    }

    if (updated.googleApiKey) {
      updated.googleApiKey = encryptApiKey(updated.googleApiKey);
    }

    if (updated.oracleToolkitToken) {
      updated.oracleToolkitToken = encryptStoredSecret(updated.oracleToolkitToken);
    }

    if (updated.devkitBridgeToken) {
      updated.devkitBridgeToken = encryptStoredSecret(updated.devkitBridgeToken);
    }
    
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Async settings loader — properly decrypts AES-GCM keys
export async function getSettingsAsync(): Promise<Settings> {
  if (!isBrowser) return defaultSettings;

  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (stored) {
      const parsed = JSON.parse(stored);

      if (parsed.apiKey && isEncrypted(parsed.apiKey)) {
        parsed.apiKey = await decryptApiKeyAsync(parsed.apiKey);
      }
      if (parsed.googleApiKey && isEncrypted(parsed.googleApiKey)) {
        parsed.googleApiKey = await decryptApiKeyAsync(parsed.googleApiKey);
      }
      if (parsed.provider !== 'openai' && parsed.provider !== 'google') {
        parsed.provider = 'google';
      }
      if (typeof parsed.oracleToolkitToken === 'string') {
        parsed.oracleToolkitToken = await decryptStoredSecretAsync(parsed.oracleToolkitToken);
      }
      if (typeof parsed.devkitBridgeToken === 'string') {
        parsed.devkitBridgeToken = await decryptStoredSecretAsync(parsed.devkitBridgeToken);
      }
      if (parsed.preferredDeploymentNetwork !== 'mainnet') {
        parsed.preferredDeploymentNetwork = 'testnet';
      }

      return { ...defaultSettings, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load settings (async):', e);
  }
  return defaultSettings;
}

// Get decrypted API key (convenience function)
export function getDecryptedApiKey(): string {
  const settings = getSettings();
  return settings.apiKey;
}

// Chat History
export function getChatHistory(): ChatSession[] {
  if (!isBrowser) return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load chat history:', e);
  }
  return [];
}

export function saveChatSession(session: ChatSession): void {
  if (!isBrowser) return;
  
  try {
    const history = getChatHistory();
    const existingIndex = history.findIndex(s => s.id === session.id);
    
    if (existingIndex >= 0) {
      history[existingIndex] = session;
    } else {
      history.unshift(session);
    }
    
    // Keep only last 50 sessions
    const trimmed = history.slice(0, 50);
    localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('Failed to save chat session:', e);
  }
}

export function deleteChatSession(sessionId: string): void {
  if (!isBrowser) return;
  
  try {
    const history = getChatHistory();
    const filtered = history.filter(s => s.id !== sessionId);
    localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(filtered));
  } catch (e) {
    console.error('Failed to delete chat session:', e);
  }
}

export function getChatSession(sessionId: string): ChatSession | null {
  const history = getChatHistory();
  return history.find(s => s.id === sessionId) || null;
}

// Current chat (for persistence across page navigation)
export function getCurrentChat(): ChatMessage[] {
  if (!isBrowser) return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_CHAT);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load current chat:', e);
  }
  return [];
}

export function saveCurrentChat(messages: ChatMessage[]): void {
  if (!isBrowser) return;
  
  try {
    localStorage.setItem(STORAGE_KEYS.CURRENT_CHAT, JSON.stringify(messages));
  } catch (e) {
    console.error('Failed to save current chat:', e);
  }
}

export function clearCurrentChat(): void {
  if (!isBrowser) return;
  localStorage.removeItem(STORAGE_KEYS.CURRENT_CHAT);
}

// Pending contract transfer between Chat -> Simulate routes
export function savePendingSimulationContract(contract: PendingSimulationContract): void {
  if (!isBrowser) return;

  try {
    localStorage.setItem(STORAGE_KEYS.PENDING_SIMULATION, JSON.stringify(contract));
  } catch (e) {
    console.error('Failed to save pending simulation contract:', e);
  }
}

export function getPendingSimulationContract(): PendingSimulationContract | null {
  if (!isBrowser) return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PENDING_SIMULATION);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as PendingSimulationContract;
    if (!parsed?.code || typeof parsed.code !== 'string') {
      return null;
    }

    return parsed;
  } catch (e) {
    console.error('Failed to load pending simulation contract:', e);
    return null;
  }
}

export function clearPendingSimulationContract(): void {
  if (!isBrowser) return;
  localStorage.removeItem(STORAGE_KEYS.PENDING_SIMULATION);
}

// Generate unique ID
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Generate chat title from first message
export function generateChatTitle(firstMessage: string): string {
  const cleaned = firstMessage.trim().slice(0, 50);
  return cleaned.length < firstMessage.length ? cleaned + '...' : cleaned;
}
