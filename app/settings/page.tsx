'use client'

import { Sidebar } from '@/components/sidebar'
import { CyberCard } from '@/components/ui/cyber-card'
import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { getSettings, getSettingsAsync, saveSettings, type Settings } from '@/lib/storage'
import { getRAGStats } from '@/lib/rag'
import { RPC_URLS } from '@/lib/testnet'
import { Check, Eye, EyeOff, Cloud, Server, Database } from 'lucide-react'

interface SettingSection {
  id: string
  label: string
}

const sections: SettingSection[] = [
  { id: 'connectivity', label: 'Connectivity' },
  { id: 'rag', label: 'Knowledge Base' },
  { id: 'agent', label: 'Agent' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'api', label: 'API Keys' },
  { id: 'oracle', label: 'Oracle Toolkit' },
  { id: 'devkit', label: 'Dev Kit' },
]

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('agent')
  const [settings, setSettingsState] = useState<Settings>(() => getSettings())
  const ragStats = getRAGStats()
  const [showApiKey, setShowApiKey] = useState(false)
  const [showGoogleApiKey, setShowGoogleApiKey] = useState(false)
  const [showDevkitToken, setShowDevkitToken] = useState(false)

  const isBrowser = typeof window !== 'undefined'
  const [themeMode, setThemeMode] = useState(() => (isBrowser ? localStorage.getItem('qubic-theme-mode') : null) || 'dark')
  const [compactMode, setCompactMode] = useState(() => isBrowser ? localStorage.getItem('qubic-compact') === '1' : false)
  const [animationsOn, setAnimationsOn] = useState(() => isBrowser ? localStorage.getItem('qubic-animations') !== '0' : true)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingUpdatesRef = useRef<Partial<Settings>>({})

  const debouncedSave = useCallback((updates: Partial<Settings>) => {
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      saveSettings(pendingUpdatesRef.current)
      pendingUpdatesRef.current = {}
    }, 400)
  }, [])

  const updateSettings = (updates: Partial<Settings>) => {
    setSettingsState((currentSettings) => {
      const newSettings = { ...currentSettings, ...updates }
      debouncedSave(updates)
      return newSettings
    })
  }

  useEffect(() => {
    let mounted = true
    getSettingsAsync()
      .then((loaded) => {
        if (mounted) setSettingsState(loaded)
      })
      .catch(() => {
        // Keep sync fallback settings if async decrypt fails
      })

    return () => {
      mounted = false
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      if (Object.keys(pendingUpdatesRef.current).length > 0) {
        saveSettings(pendingUpdatesRef.current)
        pendingUpdatesRef.current = {}
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-black bg-grid">
      <Sidebar />

      <main className="lg:ml-64 min-h-screen p-4 lg:p-8 pt-20 lg:pt-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-white mb-6 gradient-text">Settings</h1>

          <div className="flex flex-col lg:flex-row gap-8">
            {/* Sidebar */}
            <div className="w-full lg:w-48 flex-shrink-0 overflow-x-auto">
              <nav className="flex lg:flex-col space-x-2 lg:space-x-0 lg:space-y-1 pb-2 lg:pb-0">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-lg transition-all text-sm',
                      activeSection === section.id
                        ? 'bg-[#B0FAFF]/10 text-[#B0FAFF] font-medium'
                        : 'text-[#A3A3A3] hover:text-white hover:bg-[#1F1F1F]'
                    )}
                  >
                    {section.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Content */}
            <div className="flex-1">
              {activeSection === 'connectivity' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <CyberCard className="p-6" glowColor="cyan">
                    <h2 className="text-lg font-bold text-white mb-4">Connectivity Defaults</h2>

                    <div className="space-y-4">
                      <div className="p-4 rounded-xl border border-[#10B981]/30 bg-[#10B981]/5">
                        <p className="text-sm font-semibold text-[#10B981]">RPC: Live by default</p>
                        <p className="text-xs text-[#A3A3A3] mt-2">
                          Network status checks query public Qubic RPC endpoints directly.
                        </p>
                        <div className="mt-2 text-xs text-[#737373]">
                          Testnet RPC: <span className="font-mono text-[#A3A3A3]">{RPC_URLS.testnet}</span>
                        </div>
                        <p className="text-xs text-[#525252] mt-2">
                          Mainnet deployment requires computor voting (451/676) and a successful IPO. This tool targets testnet only.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5">
                        <p className="text-sm font-semibold text-[#F59E0B]">Dev Kit Bridge: Opt-in</p>
                        <p className="text-xs text-[#A3A3A3] mt-2">
                          Compile/deploy execution is disabled until server env vars are configured
                          (including <span className="font-mono">QUBIC_DEVKIT_ENABLE_EXEC=1</span> and command templates).
                        </p>
                      </div>

                      <div className="p-4 rounded-xl border border-[#A855F7]/30 bg-[#A855F7]/5">
                        <p className="text-sm font-semibold text-[#C084FC]">Oracle Queries: Local Toolkit required</p>
                        <p className="text-xs text-[#A3A3A3] mt-2">
                          Payload generation is in-app, but submission requires a running local
                          Qubic.Net Toolkit instance (localhost / 127.0.0.1).
                        </p>
                        <div className="mt-2 text-xs text-[#737373]">
                          Default Toolkit URL: <span className="font-mono text-[#A3A3A3]">http://127.0.0.1:5060</span>
                        </div>
                      </div>
                    </div>
                  </CyberCard>

                  <CyberCard className="p-6" glowColor="purple">
                    <h3 className="text-sm font-bold text-white mb-3">Official References</h3>
                    <ul className="space-y-2 text-xs">
                      <li>
                        <a className="text-[#B0FAFF] hover:underline" href="https://docs.qubic.org/api/rpc/" target="_blank" rel="noreferrer">
                          Qubic RPC docs
                        </a>
                      </li>
                      <li>
                        <a className="text-[#B0FAFF] hover:underline" href="https://docs.qubic.org/developers/dev-kit/" target="_blank" rel="noreferrer">
                          Qubic Dev Kit docs
                        </a>
                      </li>
                      <li>
                        <a className="text-[#B0FAFF] hover:underline" href="https://docs.qubic.org/developers/oracles/" target="_blank" rel="noreferrer">
                          Oracle Machines docs
                        </a>
                      </li>
                      <li>
                        <a className="text-[#B0FAFF] hover:underline" href="https://qubic.org/blog-detail/how-to-query-qubic-oracle-machines-using-the-qubic.net-toolkit" target="_blank" rel="noreferrer">
                          Qubic.Net Toolkit oracle query guide
                        </a>
                      </li>
                    </ul>
                  </CyberCard>
                </motion.div>
              )}

              {activeSection === 'agent' && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <CyberCard className="p-6" glowColor="cyan">
                    <h2 className="text-lg font-bold text-white mb-4">Model Configuration</h2>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-[#A3A3A3] mb-2">Provider</label>
                        <div className="flex gap-2">
                          {(['google', 'openai'] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => updateSettings({ provider: p })}
                              className={cn(
                                'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all border',
                                settings.provider === p
                                  ? 'bg-[#B0FAFF]/10 text-[#B0FAFF] border-[#B0FAFF]/40'
                                  : 'bg-[#0A0A0A] text-[#A3A3A3] border-[#2A2A2A] hover:border-[#404040]'
                              )}
                            >
                              {p === 'google' ? 'Google Gemini' : 'OpenAI'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm text-[#A3A3A3] mb-2">AI Model</label>
                        <select
                          value={settings.model}
                          onChange={(e) => updateSettings({ model: e.target.value })}
                          className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#B0FAFF] transition-colors"
                        >
                          <optgroup label="Google Gemini">
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash (recommended)</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                            <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                          </optgroup>
                          <optgroup label="OpenAI">
                            <option value="gpt-4o">GPT-4o</option>
                            <option value="gpt-4-turbo">GPT-4 Turbo</option>
                            <option value="gpt-4">GPT-4</option>
                            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                          </optgroup>
                        </select>
                      </div>

                      <div className="flex items-center justify-between p-3 bg-[#0A0A0A] rounded-lg border border-[#1A1A1A]">
                        <div>
                          <p className="text-white font-medium">Auto-validate output</p>
                          <p className="text-xs text-[#737373]">Automatically run validation checks</p>
                        </div>
                        <button
                          role="switch"
                          aria-checked={settings.autoValidate}
                          aria-label="Auto-validate output"
                          onClick={() => updateSettings({ autoValidate: !settings.autoValidate })}
                          className={cn(
                            'w-11 h-6 rounded-full transition-colors relative',
                            settings.autoValidate ? 'bg-[#B0FAFF]' : 'bg-[#2A2A2A]'
                          )}
                        >
                          <span
                            className={cn(
                              'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                              settings.autoValidate ? 'left-6' : 'left-1'
                            )}
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between p-3 bg-[#0A0A0A] rounded-lg border border-[#1A1A1A]">
                        <div>
                          <p className="text-white font-medium">Show confidence score</p>
                          <p className="text-xs text-[#737373]">Display AI confidence in responses</p>
                        </div>
                        <button
                          role="switch"
                          aria-checked={settings.showConfidence}
                          aria-label="Show confidence score"
                          onClick={() => updateSettings({ showConfidence: !settings.showConfidence })}
                          className={cn(
                            'w-11 h-6 rounded-full transition-colors relative',
                            settings.showConfidence ? 'bg-[#B0FAFF]' : 'bg-[#2A2A2A]'
                          )}
                        >
                          <span
                            className={cn(
                              'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                              settings.showConfidence ? 'left-6' : 'left-1'
                            )}
                          />
                        </button>
                      </div>
                    </div>
                  </CyberCard>
                </motion.div>
              )}

              {activeSection === 'rag' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <CyberCard className="p-6" glowColor="cyan">
                    <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                      <Database className="w-5 h-5 text-[#B0FAFF]" />
                      In-App RAG Knowledge Base
                    </h2>

                    <p className="text-sm text-[#A3A3A3] mb-4">
                      Retrieval runs locally with BM25-style scoring over bundled QPI data.
                      No Supabase project or external vector database is required.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-[#B0FAFF]/25 bg-[#B0FAFF]/5 p-4">
                        <p className="text-xs text-[#737373]">Documents</p>
                        <p className="text-xl font-semibold text-white mt-1">{ragStats.totalDocuments}</p>
                      </div>
                      <div className="rounded-xl border border-[#10B981]/25 bg-[#10B981]/5 p-4">
                        <p className="text-xs text-[#737373]">Unique Terms</p>
                        <p className="text-xl font-semibold text-white mt-1">{ragStats.totalTerms}</p>
                      </div>
                      <div className="rounded-xl border border-[#F59E0B]/25 bg-[#F59E0B]/5 p-4">
                        <p className="text-xs text-[#737373]">Avg Document Length</p>
                        <p className="text-xl font-semibold text-white mt-1">{ragStats.avgDocLength} tokens</p>
                      </div>
                    </div>
                  </CyberCard>

                  <CyberCard className="p-6" glowColor="purple">
                    <h3 className="text-sm font-bold text-white mb-3">Type Breakdown</h3>
                    <div className="space-y-2">
                      {Object.entries(ragStats.typeBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center justify-between rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2">
                            <span className="text-sm text-[#D4D4D4] capitalize">{type}</span>
                            <span className="text-sm font-medium text-white">{count}</span>
                          </div>
                        ))}
                    </div>
                  </CyberCard>

                  <CyberCard className="p-6" glowColor="amber">
                    <h3 className="text-sm font-bold text-white mb-3">Source Breakdown</h3>
                    <div className="space-y-2">
                      {Object.entries(ragStats.sourceBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([source, count]) => (
                          <div key={source} className="flex items-center justify-between rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2">
                            <span className="text-sm text-[#D4D4D4]">{source}</span>
                            <span className="text-sm font-medium text-white">{count}</span>
                          </div>
                        ))}
                    </div>
                  </CyberCard>
                </motion.div>
              )}

              {activeSection === 'appearance' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <CyberCard className="p-6" glowColor="purple">
                    <h2 className="text-lg font-bold text-white mb-4">Theme</h2>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-[#A3A3A3] mb-3">Color Mode</label>
                        <div className="grid grid-cols-3 gap-3">
                          {([
                            { id: 'dark', label: 'Dark', desc: 'Pure black background', bg: '#000000', border: '#B0FAFF' },
                            { id: 'midnight', label: 'Midnight', desc: 'Deep navy tones', bg: '#0a0f1a', border: '#6366F1' },
                            { id: 'dim', label: 'Dim', desc: 'Softer dark grey', bg: '#1a1a2e', border: '#8B5CF6' },
                          ] as const).map((theme) => (
                            <button
                              key={theme.id}
                              type="button"
                              onClick={() => {
                                if (theme.id === 'dark') {
                                  document.documentElement.removeAttribute('data-theme');
                                } else {
                                  document.documentElement.setAttribute('data-theme', theme.id);
                                }
                                localStorage.setItem('qubic-theme-mode', theme.id);
                                setThemeMode(theme.id);
                              }}
                              className={cn(
                                'p-4 rounded-xl border-2 transition-all text-left',
                                themeMode === theme.id
                                  ? 'border-[#B0FAFF] bg-[#B0FAFF]/5'
                                  : 'border-[#2A2A2A] hover:border-[#404040]'
                              )}
                            >
                              <div className="w-full h-8 rounded-lg mb-2 border border-[#2A2A2A]" style={{ background: theme.bg }} />
                              <div className="text-sm font-medium text-white">{theme.label}</div>
                              <div className="text-xs text-[#737373]">{theme.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-3 bg-[#0A0A0A] rounded-lg border border-[#1A1A1A]">
                        <div>
                          <p className="text-white font-medium">Compact mode</p>
                          <p className="text-xs text-[#737373]">Reduce spacing for more content density</p>
                        </div>
                        <button
                          role="switch"
                          aria-checked={compactMode}
                          aria-label="Compact mode"
                          onClick={() => {
                            const next = !compactMode;
                            localStorage.setItem('qubic-compact', next ? '1' : '0');
                            document.documentElement.classList.toggle('compact', next);
                            setCompactMode(next);
                          }}
                          className={cn(
                            'w-11 h-6 rounded-full transition-colors relative',
                            compactMode ? 'bg-[#B0FAFF]' : 'bg-[#2A2A2A]'
                          )}
                        >
                          <span className={cn(
                            'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                            compactMode ? 'left-6' : 'left-1'
                          )} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between p-3 bg-[#0A0A0A] rounded-lg border border-[#1A1A1A]">
                        <div>
                          <p className="text-white font-medium">Animations</p>
                          <p className="text-xs text-[#737373]">Enable motion effects and transitions</p>
                        </div>
                        <button
                          role="switch"
                          aria-checked={animationsOn}
                          aria-label="Animations"
                          onClick={() => {
                            const next = !animationsOn;
                            localStorage.setItem('qubic-animations', next ? '1' : '0');
                            document.documentElement.classList.toggle('reduce-motion', !next);
                            setAnimationsOn(next);
                          }}
                          className={cn(
                            'w-11 h-6 rounded-full transition-colors relative',
                            animationsOn ? 'bg-[#B0FAFF]' : 'bg-[#2A2A2A]'
                          )}
                        >
                          <span className={cn(
                            'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                            animationsOn ? 'left-6' : 'left-1'
                          )} />
                        </button>
                      </div>
                    </div>
                  </CyberCard>

                  <CyberCard className="p-6" glowColor="cyan">
                    <h3 className="text-sm font-bold text-white mb-3">Reset</h3>
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.removeItem('qubic-theme-mode');
                        localStorage.removeItem('qubic-compact');
                        localStorage.removeItem('qubic-animations');
                        document.documentElement.style.removeProperty('--background');
                        document.documentElement.style.removeProperty('--surface');
                        document.documentElement.classList.remove('compact', 'reduce-motion');
                        setThemeMode('dark');
                        setCompactMode(false);
                        setAnimationsOn(true);
                        window.location.reload();
                      }}
                      className="text-sm text-[#EF4444] hover:text-white hover:bg-[#EF4444]/10 px-3 py-2 rounded-lg border border-[#EF4444]/30 transition-all"
                    >
                      Reset to defaults
                    </button>
                  </CyberCard>
                </motion.div>
              )}

              {activeSection === 'api' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <CyberCard className="p-6" glowColor="amber">
                    <h2 className="text-lg font-bold text-white mb-4">Google Gemini API Key</h2>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-[#A3A3A3] mb-2">Google API Key</label>
                        <div className="relative">
                          <input
                            type={showGoogleApiKey ? 'text' : 'password'}
                            value={settings.googleApiKey}
                            onChange={(e) => updateSettings({ googleApiKey: e.target.value })}
                            placeholder="AIza..."
                            className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 pr-10 text-white placeholder:text-[#737373] focus:outline-none focus:border-[#B0FAFF] transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737373] hover:text-white"
                          >
                            {showGoogleApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <p className="text-xs text-[#525252] mt-2">
                          Used when Provider is set to Google Gemini. Stored locally with AES-GCM encryption (legacy fallback retained for compatibility).
                        </p>
                      </div>

                      {settings.googleApiKey && (
                        <div className="flex items-center gap-2 text-sm text-[#10B981]">
                          <Check className="w-4 h-4" />
                          <span>Google API key saved</span>
                        </div>
                      )}
                    </div>
                  </CyberCard>

                  <CyberCard className="p-6" glowColor="amber">
                    <h2 className="text-lg font-bold text-white mb-4">OpenAI API Key</h2>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-[#A3A3A3] mb-2">OpenAI API Key</label>
                        <div className="relative">
                          <input
                            type={showApiKey ? 'text' : 'password'}
                            value={settings.apiKey}
                            onChange={(e) => updateSettings({ apiKey: e.target.value })}
                            placeholder="sk-..."
                            className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 pr-10 text-white placeholder:text-[#737373] focus:outline-none focus:border-[#B0FAFF] transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737373] hover:text-white"
                          >
                            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <p className="text-xs text-[#525252] mt-2">
                          Used when Provider is set to OpenAI. Stored locally with AES-GCM encryption (legacy fallback retained for compatibility).
                        </p>
                      </div>

                      {settings.apiKey && (
                        <div className="flex items-center gap-2 text-sm text-[#10B981]">
                          <Check className="w-4 h-4" />
                          <span>OpenAI key saved</span>
                        </div>
                      )}
                    </div>
                  </CyberCard>
                </motion.div>
              )}

              {activeSection === 'oracle' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <CyberCard className="p-6" glowColor="purple">
                    <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                      <Cloud className="w-5 h-5 text-[#B0FAFF]" />
                      Qubic.Net Toolkit Companion
                    </h2>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-[#A3A3A3] mb-2">Toolkit URL</label>
                        <input
                          type="text"
                          value={settings.oracleToolkitUrl}
                          onChange={(e) => updateSettings({ oracleToolkitUrl: e.target.value })}
                          placeholder="http://127.0.0.1:5060"
                          className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white placeholder:text-[#737373] focus:outline-none focus:border-[#B0FAFF] transition-colors"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-[#A3A3A3] mb-2">Session Token (optional)</label>
                        <input
                          type="text"
                          value={settings.oracleToolkitToken}
                          onChange={(e) => updateSettings({ oracleToolkitToken: e.target.value })}
                          placeholder="Paste token shown by toolkit --server"
                          className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white placeholder:text-[#737373] focus:outline-none focus:border-[#B0FAFF] transition-colors"
                        />
                      </div>

                      <p className="text-xs text-[#525252]">
                        Use these values in the Oracle Builder page to open your local toolkit and optionally attempt bridge submission. Tokens are stored locally with AES-GCM encryption (legacy fallback retained for compatibility).
                      </p>
                    </div>
                  </CyberCard>
                </motion.div>
              )}

              {activeSection === 'devkit' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <CyberCard className="p-6" glowColor="amber">
                    <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                      <Server className="w-5 h-5 text-[#F59E0B]" />
                      Dev Kit Bridge
                    </h2>

                    <div className="space-y-4">
                      <div className="p-4 rounded-xl border border-[#10B981]/30 bg-[#10B981]/5">
                        <p className="text-sm font-semibold text-[#10B981]">Network: Testnet</p>
                        <p className="text-xs text-[#A3A3A3] mt-2">
                          All Dev Kit pipeline actions target the Qubic testnet. Mainnet deployment requires a computor proposal, community vote (451 of 676 computors), and a successful IPO -- this cannot be done through this tool.
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm text-[#A3A3A3] mb-2">Bridge Token (optional)</label>
                        <div className="relative">
                          <input
                            type={showDevkitToken ? 'text' : 'password'}
                            value={settings.devkitBridgeToken}
                            onChange={(e) => updateSettings({ devkitBridgeToken: e.target.value })}
                            placeholder="Matches QUBIC_DEVKIT_BRIDGE_TOKEN"
                            className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 pr-10 text-white placeholder:text-[#737373] focus:outline-none focus:border-[#B0FAFF] transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => setShowDevkitToken(!showDevkitToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737373] hover:text-white"
                          >
                            {showDevkitToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-[#525252]">
                        Used as the <span className="font-mono">x-devkit-token</span> header for
                        <span className="font-mono"> /api/devkit/pipeline</span> requests from Audit and Simulation workflows. Stored locally with AES-GCM encryption (legacy fallback retained for compatibility).
                      </p>

                      {settings.devkitBridgeToken && (
                        <div className="flex items-center gap-2 text-sm text-[#10B981]">
                          <Check className="w-4 h-4" />
                          <span>Bridge token saved</span>
                        </div>
                      )}
                    </div>
                  </CyberCard>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
