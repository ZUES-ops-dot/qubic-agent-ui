'use client'

import { Sidebar } from '@/components/sidebar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CyberCard } from '@/components/ui/cyber-card'
import { MessageSquare, Trash2, Search, Clock, History, ExternalLink } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { getChatHistory, deleteChatSession, type ChatSession } from '@/lib/storage'
import { useRouter } from 'next/navigation'

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)

  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

export default function HistoryPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatSession[]>([])

  // Load history on mount + cross-tab sync via storage events + periodic refresh
  useEffect(() => {
    const loadHistory = () => {
      const sessions = getChatHistory()
      setHistory(sessions)
    }
    loadHistory()

    // Cross-tab sync: reload when localStorage changes in another tab
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'qubic-agent-history') {
        loadHistory()
      }
    }
    window.addEventListener('storage', handleStorage)

    // Same-tab refresh: poll every 5s while page is visible
    const interval = setInterval(() => {
      if (!document.hidden) loadHistory()
    }, 5000)

    return () => {
      window.removeEventListener('storage', handleStorage)
      clearInterval(interval)
    }
  }, [])

  const handleDelete = (id: string) => {
    deleteChatSession(id)
    setHistory(prev => prev.filter(h => h.id !== id))
    if (selected === id) setSelected(null)
  }

  const handleOpen = (session: ChatSession) => {
    // Navigate to chat with session ID to load it
    router.push(`/?session=${session.id}`)
  }

  const filtered = history.filter(
    (h) =>
      h.title.toLowerCase().includes(search.toLowerCase()) ||
      (h.messages[0]?.content || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-black bg-grid">
      <Sidebar />

      <main className="lg:ml-64 min-h-screen p-4 lg:p-8 pt-20 lg:pt-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <h1 className="text-2xl font-bold text-white mb-2 gradient-text">Chat History</h1>
            <p className="text-sm text-[#737373]">Access and manage your previous conversations</p>
          </motion.div>

          {/* Search */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="relative mb-6"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#737373]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg pl-10 pr-4 py-3 text-white placeholder:text-[#737373] focus:outline-none focus:border-[#B0FAFF] focus:ring-1 focus:ring-[#B0FAFF]/20 transition-all"
            />
          </motion.div>

          {/* History List */}
          <ScrollArea className="h-[calc(100vh-220px)] pr-4">
            <div className="space-y-4 pb-8">
              {filtered.length === 0 ? (
                <div className="text-center py-20 text-[#737373] bg-[#0A0A0A] rounded-2xl border border-[#1A1A1A] border-dashed">
                  <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>{search ? 'No conversations found' : 'No chat history yet'}</p>
                  <p className="text-xs mt-2">Start a conversation to see it here</p>
                </div>
              ) : (
                <AnimatePresence>
                  {filtered.map((session, index) => (
                    <motion.div
                      key={session.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => setSelected(session.id)}
                    >
                      <CyberCard 
                        className={cn(
                          "cursor-pointer transition-all p-5",
                          selected === session.id ? "border-[#B0FAFF]/50 bg-[#B0FAFF]/5" : ""
                        )}
                        glowColor={selected === session.id ? "cyan" : "purple"}
                        hover={true}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-4 min-w-0">
                            <div className={cn(
                              "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
                              selected === session.id ? "bg-[#B0FAFF] text-black" : "bg-[#1A1A1A] text-[#B0FAFF]"
                            )}>
                              <MessageSquare className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 pt-0.5">
                              <h3 className={cn(
                                "font-bold truncate text-base mb-1",
                                selected === session.id ? "text-[#B0FAFF]" : "text-white"
                              )}>
                                {session.title}
                              </h3>
                              <p className="text-sm text-[#737373] truncate mb-3">
                                {session.messages[0]?.content.slice(0, 100) || 'Empty conversation'}
                              </p>
                              
                              <div className="flex items-center gap-4 text-xs text-[#525252]">
                                <span className="flex items-center gap-1.5 bg-[#1A1A1A] px-2 py-1 rounded">
                                  <Clock className="w-3 h-3" />
                                  {formatTime(session.updatedAt)}
                                </span>
                                <span className="flex items-center gap-1.5 bg-[#1A1A1A] px-2 py-1 rounded">
                                  <MessageSquare className="w-3 h-3" />
                                  {session.messages.length} msgs
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleOpen(session)
                              }}
                              aria-label="Open session"
                              className="p-2 text-[#737373] hover:text-[#B0FAFF] hover:bg-[#B0FAFF]/10 rounded-lg transition-all"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(session.id)
                              }}
                              aria-label="Delete session"
                              className="p-2 text-[#737373] hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </CyberCard>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </ScrollArea>
        </div>
      </main>
    </div>
  )
}
