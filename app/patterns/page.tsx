'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from '@/components/sidebar'
import { CyberCard } from '@/components/ui/cyber-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, Tag, Copy, CheckCircle2, Search, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPatterns } from '@/lib/rag';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import type { ContractPattern } from '@/types';

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

export default function PatternsPage() {
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [patterns, setPatterns] = useState<ContractPattern[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const router = useRouter();

  const handleApplyPattern = useCallback((pattern: ContractPattern) => {
    const prompt = `Use this QPI pattern as a starting point and build a complete contract:\n\n\`\`\`cpp\n${pattern.code}\n\`\`\``;
    router.push(`/?prompt=${encodeURIComponent(prompt)}`);
    toast.success(`Pattern "${pattern.name}" sent to chat`);
  }, [router]);

  // Load patterns on mount
  useEffect(() => {
    async function loadPatterns() {
      setIsLoading(true);
      try {
        const data = await getPatterns();
        setPatterns(data);
      } catch (error) {
        console.error('Failed to load patterns:', error);
      } finally {
        setIsLoading(false);
      }
    }
    loadPatterns();
  }, []);

  // Filter patterns based on search and type
  const filteredPatterns = patterns.filter((p) => {
    const matchesType = typeFilter === 'all' || p.type === typeFilter;
    const matchesSearch = searchQuery === '' || 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.preconditions?.some(pc => pc.toLowerCase().includes(searchQuery.toLowerCase())) ?? false);
    return matchesType && matchesSearch;
  });

  const types = Array.from(new Set(patterns.map((p) => p.type)));

  // Search patterns (simulates RAG search - will be connected to real RAG later)
  const handleSearch = async () => {
    setIsSearching(true);
    
    // In a real RAG implementation, this would call a search endpoint
    // For now, we just rely on client-side filtering which is already reactive
    // But we simulate a network delay to show the UI state
    await new Promise(r => setTimeout(r, 500));
    
    setIsSearching(false);
  };

  // Copy pattern code
  const handleCopy = async (pattern: ContractPattern) => {
    await navigator.clipboard.writeText(pattern.code);
    setCopied(pattern.name);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-h-screen bg-black bg-grid">
      <Sidebar />
      <main className="lg:ml-64 min-h-screen p-4 lg:p-8 pt-20 lg:pt-8">
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="max-w-4xl mx-auto space-y-6"
        >
          {/* Header */}
          <motion.div variants={itemVariants}>
            <h1 className="text-2xl font-bold text-white mb-2 gradient-text">System Patterns</h1>
            <p className="text-sm text-[#737373]">Reusable patterns and templates from successful audits</p>
          </motion.div>

          {/* Search */}
          <motion.div variants={itemVariants} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#737373]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search patterns (e.g., reentrancy, access control)..."
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg pl-10 pr-24 py-3 text-white placeholder:text-[#737373] focus:outline-none focus:border-[#B0FAFF] focus:ring-1 focus:ring-[#B0FAFF]/20 transition-all"
            />
            <Button
              onClick={handleSearch}
              disabled={isSearching}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90 h-8 px-3 text-xs"
            >
              {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Search'}
            </Button>
          </motion.div>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 text-[#B0FAFF] animate-spin" />
            </div>
          ) : (
            <>
              {/* Filters */}
              <motion.div variants={itemVariants} className="flex gap-3 flex-wrap items-center">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-40 bg-[#1F1F1F] border-[#2A2A2A] text-white text-xs h-9">
                    <SelectValue placeholder="Filter by type" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1F1F1F] border-[#2A2A2A] text-white">
                    <SelectItem value="all">All Types</SelectItem>
                    {types.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="text-xs text-[#737373] flex items-center gap-2">
                  <span>Showing {filteredPatterns.length} patterns</span>
                </div>
              </motion.div>

              {/* Patterns Grid */}
              <motion.div variants={itemVariants} className="space-y-4">
                <AnimatePresence mode="popLayout">
                {filteredPatterns.map((pattern, index) => (
                  <motion.div
                    key={pattern.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ y: -2 }}
                  >
                  <CyberCard 
                    className={cn(
                      "overflow-hidden transition-all duration-300",
                      expandedId === pattern.id ? "bg-[#B0FAFF]/5 border-[#B0FAFF]/30" : ""
                    )}
                    hover={true}
                    glowColor={expandedId === pattern.id ? "cyan" : undefined}
                  >
                    <div
                      className="p-6 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === pattern.id ? null : pattern.id)}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className={cn(
                              "text-base font-mono font-bold transition-colors",
                              expandedId === pattern.id ? "text-[#B0FAFF]" : "text-white"
                            )}>
                              {pattern.name}
                            </h3>
                            <Badge variant="outline" className="bg-[#B0FAFF]/10 text-[#B0FAFF] border-[#B0FAFF]/30 text-xs hover:bg-[#B0FAFF]/20">
                              {pattern.type}
                            </Badge>
                          </div>

                          {/* Stats Row */}
                          <div className="flex gap-6 text-xs text-[#737373]">
                            <div>
                              <span>conf=</span>
                              <span className="text-white font-bold ml-1">{((pattern.confidence || 0) * 100).toFixed(0)}%</span>
                            </div>
                            <div>
                              <span>applied=</span>
                              <span className="text-white font-bold ml-1">
                                {pattern.applied || 0}/{pattern.total || 0}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Expand Icon */}
                        <div className={cn(
                          "p-2 rounded-full transition-all duration-300",
                          expandedId === pattern.id ? "bg-[#B0FAFF]/10 text-[#B0FAFF]" : "text-[#737373] hover:text-white"
                        )}>
                          <ChevronDown
                            className={`h-5 w-5 transition-transform duration-300 ${
                              expandedId === pattern.id ? 'rotate-180' : ''
                            }`}
                          />
                        </div>
                      </div>

                      {/* Expanded Content */}
                      <AnimatePresence>
                      {expandedId === pattern.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.3 }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-[#2A2A2A] mt-4 pt-4 space-y-4">
                            {/* Preconditions */}
                            {pattern.preconditions && (
                            <div>
                              <h4 className="text-xs font-bold text-white mb-2 uppercase tracking-wider flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#B0FAFF]" />
                                Preconditions
                              </h4>
                              <ul className="space-y-2 text-xs text-[#A3A3A3] bg-[#0A0A0A]/50 p-3 rounded-lg border border-[#1A1A1A]">
                                {pattern.preconditions.map((cond, idx) => (
                                  <li key={idx} className="flex items-start gap-2">
                                    <span className="text-[#B0FAFF] mt-0.5">→</span>
                                    <span>{cond}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            )}

                            {/* Evidence */}
                            {pattern.evidence && (
                            <div>
                              <h4 className="text-xs font-bold text-white mb-2 uppercase tracking-wider flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                                Evidence
                              </h4>
                              <div className="p-3 bg-[#0A0A0A] rounded-lg border border-[#1A1A1A] text-xs text-[#A3A3A3] flex items-start gap-3">
                                <CheckCircle2 className="w-4 h-4 text-[#10B981] flex-shrink-0" />
                                {pattern.evidence}
                              </div>
                            </div>
                            )}

                            {/* Code Preview */}
                            <div>
                              <h4 className="text-xs font-bold text-white mb-2 uppercase tracking-wider flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
                                Code Template
                              </h4>
                              <div className="bg-[#050505] rounded-lg border border-[#1A1A1A] overflow-hidden font-mono text-xs shadow-inner p-4">
                                <pre className="text-[#A3A3A3] whitespace-pre-wrap">{pattern.code}</pre>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 flex-wrap pt-2">
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleApplyPattern(pattern);
                                }}
                                className="bg-[#B0FAFF] text-[#000] hover:bg-[#B0FAFF]/90 text-xs h-9 px-4 font-bold shadow-[0_0_15px_rgba(176,250,255,0.2)] hover:shadow-[0_0_20px_rgba(176,250,255,0.4)] transition-all"
                              >
                                <Tag className="h-3.5 w-3.5 mr-2" />
                                Apply Pattern
                              </Button>
                              <Button 
                                variant="outline" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(pattern);
                                }}
                                className="border-[#2A2A2A] text-white hover:bg-[#2A2A2A] text-xs h-9"
                              >
                                {copied === pattern.name ? (
                                  <>
                                    <Check className="h-3.5 w-3.5 mr-2 text-[#10B981]" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3.5 w-3.5 mr-2" />
                                    Copy Code
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                      </AnimatePresence>
                    </div>
                  </CyberCard>
                  </motion.div>
                ))}
                </AnimatePresence>
              </motion.div>

              {/* Summary Stats */}
              <motion.div variants={itemVariants}>
              <CyberCard glowColor="purple" className="p-6">
                <h3 className="text-sm font-bold mb-4 text-white">LIBRARY STATS</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-[#2A2A2A] rounded border border-[#2A2A2A]">
                    <div className="text-2xl font-bold text-[#B0FAFF]">{patterns.length}</div>
                    <div className="text-xs text-[#737373]">Total Patterns</div>
                  </div>
                  <div className="text-center p-3 bg-[#2A2A2A] rounded border border-[#2A2A2A]">
                    <div className="text-2xl font-bold text-[#F59E0B]">{types.length}</div>
                    <div className="text-xs text-[#737373]">Categories</div>
                  </div>
                  <div className="text-center p-3 bg-[#2A2A2A] rounded border border-[#2A2A2A]">
                    <div className="text-2xl font-bold text-[#B0FAFF]">
                      {(
                        patterns.length > 0 ? (patterns.reduce((acc, p) => acc + (p.confidence || 0), 0) / patterns.length * 100).toFixed(0) : 0
                      )}
                      %
                    </div>
                    <div className="text-xs text-[#737373]">Avg Confidence</div>
                  </div>
                  <div className="text-center p-3 bg-[#2A2A2A] rounded border border-[#2A2A2A]">
                    <div className="text-2xl font-bold text-[#B0FAFF]">
                      {patterns.reduce((acc, p) => acc + (p.applied || 0), 0)}
                    </div>
                    <div className="text-xs text-[#737373]">Applied Total</div>
                  </div>
                </div>
              </CyberCard>
              </motion.div>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}
