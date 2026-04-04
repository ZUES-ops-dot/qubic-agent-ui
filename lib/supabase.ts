// RAG search facade — delegates entirely to the in-app BM25 engine in lib/rag.ts
// Supabase is no longer required. All search is local, offline, and zero-latency.

import type { RAGDocument, Vulnerability, ContractPattern } from '@/types';
import {
  searchContracts as ragSearchContracts,
  searchVulnerabilities as ragSearchVulnerabilities,
  getPatterns as ragGetPatterns,
} from './rag';

// Kept for any settings page that checks this — always false now
export function isSupabaseConfigured(): boolean {
  return false;
}

export async function searchContracts(
  query: string,
  options: { filterSource?: string; limit?: number } = {}
): Promise<RAGDocument[]> {
  return ragSearchContracts(query, options);
}

export async function searchVulnerabilities(
  query: string,
  options: { severity?: string; limit?: number } = {}
): Promise<Vulnerability[]> {
  return ragSearchVulnerabilities(query, options);
}

export async function getPatterns(type?: string): Promise<ContractPattern[]> {
  return ragGetPatterns(type);
}
