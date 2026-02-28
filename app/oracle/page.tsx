'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Cloud, Copy, ExternalLink, FlaskConical, Send } from 'lucide-react';
import { Sidebar } from '@/components/sidebar';
import { CyberCard } from '@/components/ui/cyber-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getSettingsAsync, saveSettings } from '@/lib/storage';
import { getTestnetStatus, type TestnetStatus } from '@/lib/testnet';
import {
  ORACLE_PAIR_PRESETS,
  ORACLE_SOURCES,
  buildOraclePayload,
  formatToolkitLaunchUrl,
  splitPair,
  submitOracleQueryViaToolkitBridge,
  type OracleDraft,
} from '@/lib/oracle';
import { toast } from '@/lib/toast';

interface QueryLogItem {
  id: string;
  status: 'success' | 'error';
  message: string;
  timestamp: string;
}

const pairFallback = ['BTC/USDT', 'ETH/USDT', 'Custom'];

function nowAsInputDateTime(): string {
  const date = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export default function OraclePage() {
  const [oracleInterface, setOracleInterface] = useState<'price' | 'test'>('price');
  const [oracleSource, setOracleSource] = useState('binance');
  const [pairPreset, setPairPreset] = useState('BTC/USDT');
  const [currency1, setCurrency1] = useState('BTC');
  const [currency2, setCurrency2] = useState('USDT');
  const [timestamp, setTimestamp] = useState(nowAsInputDateTime());
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [testValue, setTestValue] = useState(42);

  const [toolkitUrl, setToolkitUrl] = useState('http://127.0.0.1:5060');
  const [toolkitToken, setToolkitToken] = useState('');
  const [bridgeEndpoint, setBridgeEndpoint] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bridgeNote, setBridgeNote] = useState('');

  const [queryLog, setQueryLog] = useState<QueryLogItem[]>([]);
  const [testnetStatus, setTestnetStatus] = useState<TestnetStatus | null>(null);

  const currentPairs = ORACLE_PAIR_PRESETS[oracleSource] || pairFallback;

  useEffect(() => {
    let mounted = true;
    getSettingsAsync()
      .then((saved) => {
        if (!mounted) return;
        setToolkitUrl(saved.oracleToolkitUrl || 'http://127.0.0.1:5060');
        setToolkitToken(saved.oracleToolkitToken || '');
      })
      .catch(() => {
        // Keep local defaults if async decrypt fails
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    getTestnetStatus().then(setTestnetStatus).catch(() => setTestnetStatus(null));
  }, []);

  useEffect(() => {
    if (!currentPairs.includes(pairPreset)) {
      setPairPreset(currentPairs[0]);
    }
  }, [currentPairs, pairPreset]);

  useEffect(() => {
    if (pairPreset !== 'Custom') {
      const parsed = splitPair(pairPreset);
      setCurrency1(parsed.currency1);
      setCurrency2(parsed.currency2);
    }
  }, [pairPreset]);

  const draft = useMemo<OracleDraft>(() => {
    if (oracleInterface === 'price') {
      return {
        interface: 'price',
        oracleSource,
        currency1: currency1.trim().toUpperCase(),
        currency2: currency2.trim().toUpperCase(),
        timeoutSeconds,
        timestamp: new Date(timestamp),
      };
    }

    return {
      interface: 'test',
      value: Math.max(0, Math.floor(testValue)),
      timeoutSeconds,
    };
  }, [oracleInterface, oracleSource, currency1, currency2, timeoutSeconds, timestamp, testValue]);

  const payloadPreview = useMemo(() => buildOraclePayload(draft), [draft]);
  const launchUrl = useMemo(() => formatToolkitLaunchUrl(toolkitUrl, toolkitToken), [toolkitUrl, toolkitToken]);

  const appendQueryLog = (status: QueryLogItem['status'], message: string) => {
    setQueryLog((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status,
        message,
        timestamp: new Date().toLocaleTimeString(),
      },
      ...prev,
    ].slice(0, 8));
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  const handleSaveToolkitConfig = () => {
    saveSettings({
      oracleToolkitUrl: toolkitUrl.trim(),
      oracleToolkitToken: toolkitToken.trim(),
    });
    toast.success('Toolkit settings saved');
  };

  const handleOpenToolkit = () => {
    if (!launchUrl) {
      toast.warning('Set Toolkit URL first');
      return;
    }
    window.open(launchUrl, '_blank', 'noopener,noreferrer');
  };

  const canSubmitBridge = toolkitUrl.trim().length > 0 && (oracleInterface === 'test' || (currency1.trim() && currency2.trim()));

  const handleSubmitBridge = async () => {
    if (!canSubmitBridge) {
      toast.warning('Complete query fields first');
      return;
    }

    setIsSubmitting(true);
    setBridgeNote('');

    try {
      const response = await submitOracleQueryViaToolkitBridge({
        toolkitUrl: toolkitUrl.trim(),
        toolkitToken: toolkitToken.trim() || undefined,
        explicitEndpoint: bridgeEndpoint.trim() || undefined,
        query: draft,
      });

      if (response.ok) {
        const endpointInfo = response.endpoint ? ` via ${response.endpoint}` : '';
        const message = `Bridge accepted query${endpointInfo}`;
        setBridgeNote(message);
        appendQueryLog('success', message);
        toast.success(message);
      } else {
        const message = response.note || 'Bridge did not return success';
        setBridgeNote(message);
        appendQueryLog('error', message);
        toast.warning(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bridge request failed';
      setBridgeNote(message);
      appendQueryLog('error', message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black bg-grid">
      <Sidebar />
      <main className="lg:ml-64 min-h-screen p-4 lg:p-8 pt-20 lg:pt-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="relative">
                <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-[#B0FAFF]/[0.02] blur-[60px] pointer-events-none" />
                <h1 className="text-2xl font-bold text-white gradient-text relative">Oracle Machine Builder</h1>
                <p className="text-sm text-[#737373] mt-1 relative">Build Toolkit-compatible payloads and bridge them to your local Qubic.Net Toolkit session.</p>
              </div>
            </div>
            <div className={cn(
              'px-3 py-1 rounded-full border text-xs',
              testnetStatus?.online ? 'text-[#10B981] border-[#10B981]/40 bg-[#10B981]/10' : 'text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/10'
            )}>
              <Activity className="w-3 h-3 inline mr-1" />
              {testnetStatus?.online ? `RPC ${testnetStatus.rpcSource.toUpperCase()} ONLINE` : 'RPC OFFLINE / TOOLKIT MODE'}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <CyberCard className="p-6" glowColor="cyan">
                <h2 className="text-sm font-bold text-white mb-4">QUERY CONFIG</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#A3A3A3] block mb-2">Interface</label>
                    <select value={oracleInterface} onChange={(e) => setOracleInterface(e.target.value as 'price' | 'test')} className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white">
                      <option value="price">Price Oracle</option>
                      <option value="test">Test Oracle</option>
                    </select>
                  </div>

                  {oracleInterface === 'price' ? (
                    <>
                      <div>
                        <label className="text-xs text-[#A3A3A3] block mb-2">Source</label>
                        <select value={oracleSource} onChange={(e) => setOracleSource(e.target.value)} className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white">
                          {ORACLE_SOURCES.map((source) => (
                            <option key={source.value} value={source.value}>{source.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-[#A3A3A3] block mb-2">Pair preset</label>
                        <select value={pairPreset} onChange={(e) => setPairPreset(e.target.value)} className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white">
                          {currentPairs.map((pair) => (
                            <option key={pair} value={pair}>{pair}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-[#A3A3A3] block mb-2">Currency 1</label>
                        <input value={currency1} onChange={(e) => setCurrency1(e.target.value)} className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white" />
                      </div>
                      <div>
                        <label className="text-xs text-[#A3A3A3] block mb-2">Currency 2</label>
                        <input value={currency2} onChange={(e) => setCurrency2(e.target.value)} className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white" />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-xs text-[#A3A3A3] block mb-2">Timestamp (UTC)</label>
                        <input type="datetime-local" value={timestamp} onChange={(e) => setTimestamp(e.target.value)} className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white" />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="text-xs text-[#A3A3A3] block mb-2">Test value (uint64)</label>
                      <input type="number" min={0} value={testValue} onChange={(e) => setTestValue(Number(e.target.value))} className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white" />
                    </div>
                  )}

                  <div>
                    <label className="text-xs text-[#A3A3A3] block mb-2">Timeout (seconds)</label>
                    <input type="number" min={1} max={3600} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white" />
                  </div>
                </div>
              </CyberCard>

              <CyberCard className="p-6" glowColor="green">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <h2 className="text-sm font-bold text-white">ENCODED PAYLOAD PREVIEW</h2>
                  <div className="text-xs text-[#A3A3A3]">Interface {payloadPreview.interfaceIndex} · {payloadPreview.bytes.length} bytes</div>
                </div>
                <div className="space-y-3">
                  <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg">
                    <div className="text-xs text-[#737373] mb-1">HEX</div>
                    <div className="text-[11px] text-white font-mono break-all">{payloadPreview.hex}</div>
                  </div>
                  <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg">
                    <div className="text-xs text-[#737373] mb-1">BASE64</div>
                    <div className="text-[11px] text-white font-mono break-all">{payloadPreview.base64}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button variant="outline" className="border-[#1A1A1A] text-white" onClick={() => handleCopy(payloadPreview.hex, 'Hex payload')}>
                    <Copy className="w-4 h-4 mr-2" />Copy Hex
                  </Button>
                  <Button variant="outline" className="border-[#1A1A1A] text-white" onClick={() => handleCopy(payloadPreview.base64, 'Base64 payload')}>
                    <Copy className="w-4 h-4 mr-2" />Copy Base64
                  </Button>
                </div>
              </CyberCard>
            </div>

            <div className="space-y-6">
              <CyberCard className="p-6" glowColor="purple">
                <h2 className="text-sm font-bold text-white mb-4">TOOLKIT COMPANION</h2>
                <div className="space-y-3">
                  <input value={toolkitUrl} onChange={(e) => setToolkitUrl(e.target.value)} placeholder="http://127.0.0.1:5060" className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white" />
                  <input value={toolkitToken} onChange={(e) => setToolkitToken(e.target.value)} placeholder="Optional session token" className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white" />
                  <input value={bridgeEndpoint} onChange={(e) => setBridgeEndpoint(e.target.value)} placeholder="Optional custom bridge endpoint" className="w-full bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg px-3 py-2 text-white" />
                </div>
                <div className="flex flex-col gap-2 mt-4">
                  <Button onClick={handleSaveToolkitConfig} variant="outline" className="border-[#1A1A1A] text-white">
                    <Cloud className="w-4 h-4 mr-2" />Save Toolkit Config
                  </Button>
                  <Button onClick={handleOpenToolkit} variant="outline" className="border-[#1A1A1A] text-white">
                    <ExternalLink className="w-4 h-4 mr-2" />Open Toolkit
                  </Button>
                  <Button onClick={handleSubmitBridge} disabled={isSubmitting} className="bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90">
                    {isSubmitting ? (
                      <>
                        <FlaskConical className="w-4 h-4 mr-2 animate-pulse" />Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />Send via Bridge
                      </>
                    )}
                  </Button>
                </div>
                {bridgeNote && <p className="text-xs text-[#A3A3A3] mt-3">{bridgeNote}</p>}
              </CyberCard>

              <CyberCard className="p-6" glowColor="amber">
                <h2 className="text-sm font-bold text-white mb-3">RECENT BRIDGE EVENTS</h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {queryLog.length === 0 && <p className="text-xs text-[#737373]">No bridge activity yet.</p>}
                  {queryLog.map((item) => (
                    <div key={item.id} className={cn('p-3 rounded border text-xs', item.status === 'success' ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#10B981]' : 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[#EF4444]')}>
                      <div className="font-semibold">{item.message}</div>
                      <div className="text-[10px] opacity-80 mt-1">{item.timestamp}</div>
                    </div>
                  ))}
                </div>
              </CyberCard>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
