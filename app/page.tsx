'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar } from '@/components/sidebar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Send,
  Sparkles,
  Code,
  Shield,
  Zap,
  Cloud,
  CheckCircle,
  Loader2,
  Copy,
  StopCircle,
  PlayCircle,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { streamChatWithAgent, type Message as AgentMessage } from '@/lib/agent'
import {
  saveChatSession, 
  getChatSession, 
  generateId, 
  generateChatTitle,
  getSettingsAsync,
  getSettings,
  savePendingSimulationContract,
  type ChatSession,
  type ChatMessage 
} from '@/lib/storage'
import { MessageContent, parseCodeBlocks } from '@/components/ui/code-block'
import { ErrorBoundary } from '@/components/error-boundary'
import { toast } from '@/lib/toast'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  status?: 'thinking' | 'generating' | 'validating' | 'complete'
  agentAction?: string
}

const quickActions = [
  { icon: Code, label: 'Generate Contract', prompt: 'Generate a Qubic smart contract for' },
  { icon: Shield, label: 'Audit Code', prompt: 'Audit this smart contract for vulnerabilities' },
  { icon: Zap, label: 'Optimize', prompt: 'Optimize this contract for performance' },
  { icon: Cloud, label: 'Oracle Query Builder', prompt: 'Help me build a Qubic Oracle Machine price query for' },
]

function extractSimulationCodePayload(content: string): { name: string; code: string } | null {
  const codeBlocks = parseCodeBlocks(content)
    .filter((part) => part.type === 'code')
    .map((part) => part.content.trim())
    .filter(Boolean);

  if (codeBlocks.length === 0) {
    return null;
  }

  const code = codeBlocks.find((candidate) => /struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*public\s+ContractBase/.test(candidate))
    || codeBlocks.find((candidate) => /PUBLIC_(FUNCTION|PROCEDURE)/.test(candidate));

  if (!code) {
    return null;
  }

  const name = code.match(/struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*public\s+ContractBase/)?.[1] || 'UserContract';
  return { name, code };
}

function ChatPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [agentStatus, setAgentStatus] = useState<'idle' | 'working' | 'paused'>('idle')
  const [currentAction, setCurrentAction] = useState('')
  const [sessionId, setSessionId] = useState<string>('')
  const [copied, setCopied] = useState<string | null>(null)
  const [userSettings, setUserSettings] = useState(getSettings())
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load session from URL param or create new
  useEffect(() => {
    const sessionParam = searchParams.get('session')
    if (sessionParam) {
      const session = getChatSession(sessionParam)
      if (session) {
        setSessionId(session.id)
        setMessages(session.messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp),
          status: 'complete' as const
        })))
      } else {
        setSessionId(generateId())
        setMessages([])
      }
    } else {
      setSessionId(generateId())
      setMessages([])
    }

    // Pre-fill input from ?prompt= param (used by Patterns "Apply" button)
    const promptParam = searchParams.get('prompt')
    if (promptParam) {
      setInput(promptParam)
      inputRef.current?.focus()
    }
  }, [searchParams])

  // Navigate to simulate with contract context
  const handleSimulateContract = (assistantMessage: Message, payload: { name: string; code: string }) => {
    savePendingSimulationContract({
      name: payload.name,
      type: 'qpi-contract',
      description: 'LLM-generated Qubic smart contract',
      code: payload.code,
      network: 'testnet',
      createdAt: new Date().toISOString(),
      sourceMessageId: assistantMessage.id,
    });

    const params = new URLSearchParams({
      contract: payload.name,
      type: 'qpi-contract',
      desc: 'LLM-generated Qubic smart contract',
      from: 'chat',
      network: 'testnet',
    })
    router.push(`/simulate?${params.toString()}`)
  }

  // Copy code to clipboard
  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    let mounted = true

    const loadSettings = async () => {
      try {
        const loaded = await getSettingsAsync()
        if (mounted) setUserSettings(loaded)
      } catch {
        if (mounted) setUserSettings(getSettings())
      }
    }

    void loadSettings()
    const handleStorage = () => {
      void loadSettings()
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      mounted = false
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const estimateConfidence = (content: string) => {
    if (!content.trim()) return 0
    if (content.includes('**Error**') || content.includes('**API Key')) return 0
    let score = 60
    // Boost: contains QPI-specific patterns the LLM learned correctly
    if (content.includes('ContractBase')) score += 8
    if (content.includes('REGISTER_USER_FUNCTIONS_AND_PROCEDURES')) score += 6
    if (content.includes('INITIALIZE')) score += 4
    if (content.includes('using namespace QPI')) score += 4
    if (content.includes('_input') && content.includes('_output')) score += 4
    // Boost: tool usage indicates RAG grounding
    if (content.includes('verify_and_fix') || content.includes('search_contracts')) score += 6
    // Boost: code block present
    if (content.includes('```')) score += 4
    // Penalty: mentions banned types (LLM hallucinated wrong code)
    if (/\bbool\b/.test(content) && content.includes('```')) score -= 10
    if (/\bint\b(?!8|16|32|64)/.test(content) && content.includes('```')) score -= 10
    return Math.max(0, Math.min(100, score))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isGenerating) return
    const userContent = input.trim()

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: userContent,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsGenerating(true)
    setAgentStatus('working')

    // Create assistant message placeholder
    const assistantMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      status: 'thinking',
      agentAction: 'Processing with AI...',
    }
    setMessages((prev) => [...prev, assistantMessage])
    setCurrentAction('Processing with AI...')

    try {
      // Build conversation history for context
      const history: AgentMessage[] = messages.map(m => ({
        role: m.role,
        content: m.content
      }))

      // Create abort controller for cancellation
      const controller = new AbortController()
      abortRef.current = controller

      // Use streaming response
      let fullContent = '';
      
      // Update message as stream arrives
      for await (const chunk of streamChatWithAgent(userContent, history, controller.signal, (status) => setCurrentAction(status))) {
        fullContent += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? { 
                  ...m, 
                  content: fullContent, 
                  status: 'generating', 
                  agentAction: undefined 
                }
              : m
          )
        )
      }

      // Mark as complete
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessage.id
            ? { ...m, status: 'complete', agentAction: undefined }
            : m
        )
      )

      // Save to history
      const allMessages: ChatMessage[] = [
        ...messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp.toISOString()
        })),
        {
          id: userMessage.id,
          role: userMessage.role,
          content: userMessage.content,
          timestamp: userMessage.timestamp.toISOString()
        },
        {
          id: assistantMessage.id,
          role: 'assistant',
          content: fullContent,
          timestamp: new Date().toISOString()
        }
      ]

      const session: ChatSession = {
        id: sessionId,
        title: generateChatTitle(messages[0]?.content || userContent),
        messages: allMessages,
        createdAt: messages.length === 0 ? new Date().toISOString() : allMessages[0].timestamp,
        updatedAt: new Date().toISOString()
      }
      saveChatSession(session)

    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Show toast notification
      toast.error(`Failed to get response: ${errorMessage}`);
      
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessage.id
            ? { 
                ...m, 
                content: '**Error**\n\nFailed to get response. Please check your API key in Settings.', 
                status: 'complete', 
                agentAction: undefined 
              }
            : m
        )
      )
    }

    abortRef.current = null
    setIsGenerating(false)
    setAgentStatus('idle')
    setCurrentAction('')
  }

  const handleQuickAction = (prompt: string) => {
    setInput(prompt + ' ')
    inputRef.current?.focus()
  }

  const handleOracleBuilder = () => {
    router.push('/oracle')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleStopGeneration = () => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsGenerating(false)
    setAgentStatus('idle')
    setCurrentAction('')
  }

  return (
    <div className="min-h-screen bg-black bg-grid">
      <Sidebar />

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen flex flex-col pt-16 lg:pt-0 overflow-x-hidden">
        {/* Agent Status Bar */}
        {agentStatus !== 'idle' && (
          <div className="sticky top-0 z-10 bg-[#0A0A0A]/80 backdrop-blur-md border-b border-[#1A1A1A] px-6 py-3">
            <div className="flex items-center justify-between max-w-3xl mx-auto">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-2 h-2 rounded-full',
                    agentStatus === 'working' && 'bg-[#B0FAFF] animate-pulse',
                    agentStatus === 'paused' && 'bg-[#F59E0B]'
                  )}
                />
                <span className="text-sm text-[#A3A3A3]">
                  {agentStatus === 'working' ? currentAction : 'Paused'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStopGeneration}
                className="text-[#A3A3A3] hover:text-white"
              >
                <StopCircle className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-[calc(100vh-180px)]" ref={scrollRef}>
            <div className="max-w-3xl mx-auto px-4 lg:px-6 py-8">
              {messages.length === 0 ? (
                // Empty State
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="text-center py-16"
                >
                  <div className="relative mb-10">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-[300px] h-[300px] rounded-full bg-[#B0FAFF]/[0.02] blur-[80px]" />
                    </div>
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.4 }}
                      className="relative w-20 h-20 mx-auto mb-6"
                    >
                      <div className="absolute inset-0 bg-[#B0FAFF]/10 rounded-2xl rotate-6" />
                      <div className="absolute inset-0 bg-[#B0FAFF]/5 rounded-2xl -rotate-6" />
                      <div className="relative w-full h-full bg-[#0A0A0A] border border-[#B0FAFF]/20 rounded-2xl flex items-center justify-center">
                        <Sparkles className="w-9 h-9 text-[#B0FAFF]" />
                      </div>
                    </motion.div>
                    <h1 className="relative text-3xl font-bold text-white mb-3">
                      <span className="gradient-text">Qubic Agent</span>
                    </h1>
                    <p className="relative text-[#737373] text-sm max-w-md mx-auto">
                      Generate, audit, and deploy QPI smart contracts through conversation. Backed by a curated knowledge base of real Qubic contract patterns.
                    </p>
                  </div>

                  {/* Quick Actions Grid */}
                  <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto mb-6">
                    {quickActions.map((action, index) => (
                      <motion.button
                        key={action.label}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 + index * 0.08, duration: 0.3 }}
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleQuickAction(action.prompt)}
                        className="group flex items-center gap-3 px-4 py-3.5 bg-[#0A0A0A]/80 border border-[#1A1A1A] rounded-xl text-left hover:border-[#B0FAFF]/20 hover:bg-[#0A0A0A] hover:shadow-[0_0_30px_rgba(176,250,255,0.06)] transition-all duration-300"
                      >
                        <div className="w-9 h-9 rounded-lg bg-[#1A1A1A] flex items-center justify-center flex-shrink-0 group-hover:bg-[#B0FAFF]/10 transition-colors">
                          <action.icon className="w-4 h-4 text-[#737373] group-hover:text-[#B0FAFF] transition-colors" />
                        </div>
                        <span className="text-sm text-[#A3A3A3] group-hover:text-white transition-colors">{action.label}</span>
                      </motion.button>
                    ))}
                  </div>

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                  >
                    <Button
                      onClick={handleOracleBuilder}
                      className="bg-[#0A0A0A] border border-[#1A1A1A] text-[#737373] hover:text-[#B0FAFF] hover:border-[#B0FAFF]/20 hover:bg-[#B0FAFF]/5 transition-all duration-300"
                    >
                      <Cloud className="w-4 h-4 mr-2" />
                      Oracle Machine Builder
                    </Button>
                  </motion.div>
                </motion.div>
              ) : (
                // Messages
                <div className="space-y-6">
                  <AnimatePresence mode="popLayout">
                  {messages.map((message, index) => {
                    const simulationPayload = message.role === 'assistant'
                      ? extractSimulationCodePayload(message.content)
                      : null

                    return (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                      className={cn(
                        'flex gap-3 min-w-0',
                        message.role === 'user' && 'flex-row-reverse'
                      )}
                    >
                      {/* Avatar */}
                      <div
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                          message.role === 'user'
                            ? 'bg-[#1A1A1A] border border-[#2A2A2A]'
                            : 'bg-[#B0FAFF] shadow-[0_0_12px_rgba(176,250,255,0.2)]'
                        )}
                      >
                        {message.role === 'user' ? (
                          <span className="text-sm font-medium text-[#A3A3A3]">U</span>
                        ) : (
                          <Sparkles className="w-4 h-4 text-[#171717]" />
                        )}
                      </div>

                      {/* Content */}
                      <div
                        className={cn(
                          'min-w-0 flex-1',
                          message.role === 'user' ? 'flex justify-end' : 'flex justify-start'
                        )}
                      >
                        {message.status && message.status !== 'complete' ? (
                          // Loading state
                          <div className="inline-flex items-center gap-2 px-4 py-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-xl">
                            <Loader2 className="w-4 h-4 text-[#B0FAFF] animate-spin" />
                            <span className="text-sm text-[#A3A3A3]">
                              {message.agentAction}
                            </span>
                          </div>
                        ) : (
                          <div
                            className={cn(
                              'px-4 py-3 rounded-xl',
                              message.role === 'user'
                                ? 'bg-[#B0FAFF] text-black shadow-[0_0_20px_rgba(176,250,255,0.12)] max-w-[80%]'
                                : 'bg-[#0A0A0A]/80 text-white border border-[#1A1A1A] backdrop-blur-sm w-full'
                            )}
                          >
                            {message.role === 'user' ? (
                              <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                                {message.content}
                              </div>
                            ) : (
                              <MessageContent content={message.content} />
                            )}
                            {message.role === 'assistant' && message.status === 'complete' && (
                              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-[#1A1A1A] min-w-0">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleCopy(message.content, message.id)}
                                  className="text-[#737373] hover:text-[#B0FAFF] h-7 px-2"
                                >
                                  {copied === message.id ? (
                                    <><Check className="w-3 h-3 mr-1 text-[#10B981]" />Copied</>
                                  ) : (
                                    <><Copy className="w-3 h-3 mr-1" />Copy</>
                                  )}
                                </Button>
                                <div className="flex items-center gap-1 text-xs text-[#10B981]">
                                  <CheckCircle className="w-3 h-3" />
                                  {userSettings.autoValidate ? 'Auto-validated' : 'Tool-ready'}
                                </div>
                                {userSettings.showConfidence && (
                                  <div className="text-xs text-[#B0FAFF] bg-[#B0FAFF]/10 border border-[#B0FAFF]/20 rounded px-2 py-1">
                                    Confidence {estimateConfidence(message.content)}%
                                  </div>
                                )}
                                {/* Simulate Contract Button - shows when QPI contract code is detected */}
                                {simulationPayload && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleSimulateContract(message, simulationPayload)}
                                    className="bg-[#B0FAFF]/10 text-[#B0FAFF] border border-[#B0FAFF]/30 hover:bg-[#B0FAFF]/20 h-7 px-3 ml-auto"
                                  >
                                    <PlayCircle className="w-3 h-3 mr-1" />
                                    Simulate
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                    )})}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Input Area */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="sticky bottom-0 bg-black/90 backdrop-blur-xl border-t border-[#1A1A1A]/50 p-4"
        >
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
                }}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you want to build..."
                rows={1}
                className="w-full bg-[#0A0A0A]/60 backdrop-blur-md border border-[#1A1A1A] rounded-xl px-4 py-3 pr-12 text-white placeholder:text-[#525252] resize-none focus:outline-none focus:border-[#B0FAFF]/40 focus:ring-2 focus:ring-[#B0FAFF]/10 focus:shadow-[0_0_30px_rgba(176,250,255,0.08)] transition-all duration-300"
                style={{ minHeight: '48px', maxHeight: '200px' }}
              />
              {isGenerating ? (
                <motion.button
                  type="button"
                  onClick={handleStopGeneration}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#EF4444] text-white hover:bg-[#EF4444]/90 h-8 w-8 p-0 rounded-lg flex items-center justify-center"
                >
                  <StopCircle className="w-4 h-4" />
                </motion.button>
              ) : (
                <motion.button
                  type="submit"
                  disabled={!input.trim()}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90 disabled:opacity-50 disabled:cursor-not-allowed h-8 w-8 p-0 rounded-lg flex items-center justify-center glow-primary"
                >
                  <Send className="w-4 h-4" />
                </motion.button>
              )}
            </div>
            <p className="text-xs text-[#737373] text-center mt-2">
              Press Enter to send, Shift+Enter for new line
            </p>
          </form>
        </motion.div>
      </main>
    </div>
  )
}

// Default export with Suspense wrapper for useSearchParams
export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-[#B0FAFF] animate-pulse">Loading...</div>
      </div>
    }>
      <ErrorBoundary scope="chat-page">
        <ChatPageContent />
      </ErrorBoundary>
    </Suspense>
  )
}
