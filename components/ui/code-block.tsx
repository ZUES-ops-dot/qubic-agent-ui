'use client';

import { useState } from 'react';
import { Check, Copy, FileCode } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
}

function escapeHtml(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Simple syntax highlighting for Solidity/Qubic keywords
function highlightCode(code: string, language: string): string {
  const safeCode = escapeHtml(code);

  if (language === 'solidity' || language === 'sol') {
    return safeCode
      // Keywords
      .replace(/\b(contract|function|modifier|event|struct|mapping|require|return|if|else|for|while|pragma|import|is|public|private|internal|external|view|pure|payable|memory|storage|calldata|indexed|emit|new|delete|assembly|interface|library|abstract|virtual|override)\b/g, '<span class="text-[#B0FAFF]">$1</span>')
      // Types
      .replace(/\b(address|uint256|uint|int|bool|string|bytes|bytes32)\b/g, '<span class="text-[#F59E0B]">$1</span>')
      // Numbers
      .replace(/\b(\d+)\b/g, '<span class="text-[#10B981]">$1</span>')
      // Comments
      .replace(/(\/\/.*$)/gm, '<span class="text-[#525252]">$1</span>')
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="text-[#525252]">$1</span>')
      // Strings
      .replace(/(".*?"|'.*?')/g, '<span class="text-[#F472B6]">$1</span>');
  }
  
  if (language === 'typescript' || language === 'ts' || language === 'javascript' || language === 'js') {
    return safeCode
      .replace(/\b(const|let|var|function|return|if|else|for|while|import|export|from|async|await|class|interface|type|extends|implements|new|this|super|try|catch|throw)\b/g, '<span class="text-[#B0FAFF]">$1</span>')
      .replace(/\b(string|number|boolean|any|void|null|undefined|true|false)\b/g, '<span class="text-[#F59E0B]">$1</span>')
      .replace(/\b(\d+)\b/g, '<span class="text-[#10B981]">$1</span>')
      .replace(/(\/\/.*$)/gm, '<span class="text-[#525252]">$1</span>')
      .replace(/(".*?"|'.*?'|`.*?`)/g, '<span class="text-[#F472B6]">$1</span>');
  }

  if (language === 'cpp' || language === 'c++' || language === 'c' || language === 'h' || language === 'qpi') {
    return safeCode
      // QPI macros and contract structure
      .replace(/\b(PUBLIC_FUNCTION|PUBLIC_PROCEDURE|PRIVATE_FUNCTION|PRIVATE_PROCEDURE|PUBLIC_FUNCTION_WITH_LOCALS|PUBLIC_PROCEDURE_WITH_LOCALS|PRIVATE_FUNCTION_WITH_LOCALS|PRIVATE_PROCEDURE_WITH_LOCALS|REGISTER_USER_FUNCTIONS_AND_PROCEDURES|REGISTER_USER_FUNCTION|REGISTER_USER_PROCEDURE|INITIALIZE|INITIALIZE_WITH_LOCALS|BEGIN_EPOCH|END_EPOCH|BEGIN_TICK|END_TICK|BEGIN_EPOCH_WITH_LOCALS|END_EPOCH_WITH_LOCALS|POST_INCOMING_TRANSFER)\b/g, '<span class="text-[#C084FC] font-semibold">$1</span>')
      // QPI types
      .replace(/\b(uint8|uint16|uint32|uint64|sint8|sint16|sint32|sint64|bit|id|Array|BitArray|Collection|HashMap|HashSet|ContractBase)\b/g, '<span class="text-[#F59E0B]">$1</span>')
      // C++ keywords
      .replace(/\b(struct|public|private|using|namespace|void|const|static|return|if|else|for|while|do|switch|case|break|continue|class|template|typename|enum)\b/g, '<span class="text-[#B0FAFF]">$1</span>')
      // QPI context calls
      .replace(/\b(qpi|state|input|output|locals)\b(?=\.)/g, '<span class="text-[#10B981] font-semibold">$1</span>')
      // QPI functions
      .replace(/\b(div|mod)\b(?=\s*\()/g, '<span class="text-[#10B981]">$1</span>')
      // Numbers
      .replace(/\b(\d+)\b/g, '<span class="text-[#10B981]">$1</span>')
      // Comments
      .replace(/(\/\/.*$)/gm, '<span class="text-[#525252]">$1</span>')
      .replace(/(\/{1}\*[\s\S]*?\*\/)/g, '<span class="text-[#525252]">$1</span>');
  }

  // Default: no highlighting
  return safeCode;
}

export function CodeBlock({ code, language = 'cpp', showLineNumbers = true, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split('\n');
  const highlightedCode = highlightCode(code, language);

  return (
    <div className={cn('relative group rounded-lg overflow-hidden border border-[#1A1A1A] bg-[#0A0A0A]', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#111111] border-b border-[#1A1A1A]">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-[#525252]" />
          <span className="text-xs text-[#525252] font-mono">{language}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-[#737373] hover:text-white hover:bg-[#1A1A1A] rounded transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#10B981]" />
              <span className="text-[#10B981]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code */}
      <div className="overflow-x-auto">
        <pre className="p-4 text-sm font-mono leading-relaxed">
          {showLineNumbers ? (
            <table className="border-collapse">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="hover:bg-[#1A1A1A]/50">
                    <td className="pr-4 text-right text-[#525252] select-none w-8 align-top">
                      {i + 1}
                    </td>
                    <td className="text-white whitespace-pre">
                      <span dangerouslySetInnerHTML={{ __html: highlightCode(line, language) }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <code 
              className="text-white"
              dangerouslySetInnerHTML={{ __html: highlightedCode }} 
            />
          )}
        </pre>
      </div>
    </div>
  );
}

// Parse markdown content and extract code blocks
export function parseCodeBlocks(content: string): Array<{ type: 'text' | 'code'; content: string; language?: string }> {
  const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) {
        parts.push({ type: 'text', content: text });
      }
    }

    // Add code block
    parts.push({
      type: 'code',
      language: match[1] || 'cpp',
      content: match[2].trim(),
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) {
      parts.push({ type: 'text', content: text });
    }
  }

  return parts.length > 0 ? parts : [{ type: 'text', content }];
}

// Lightweight markdown-to-HTML for LLM text (no external deps)
function renderMarkdownToHtml(text: string): string {
  return escapeHtml(text)
    // Headers (must come before bold since ## starts lines)
    .replace(/^#{3}\s+(.+)$/gm, '<h3 class="text-base font-bold text-white mt-3 mb-1">$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2 class="text-lg font-bold text-white mt-4 mb-1">$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1 class="text-xl font-bold text-white mt-4 mb-2">$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="text-white"><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-[#1A1A1A] rounded text-[#B0FAFF] text-xs font-mono">$1</code>')
    // Links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-[#B0FAFF] underline hover:text-white">$1</a>')
    // Unordered list items
    .replace(/^[-*]\s+(.+)$/gm, '<li class="ml-4 list-disc text-[#A3A3A3]">$1</li>')
    // Ordered list items
    .replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-4 list-decimal text-[#A3A3A3]">$1</li>')
    // Horizontal rules
    .replace(/^---+$/gm, '<hr class="border-[#2A2A2A] my-3" />')
    // Line breaks (preserve paragraph spacing)
    .replace(/\n\n/g, '</p><p class="mt-2">')
    .replace(/\n/g, '<br />');
}

// Message content renderer with code blocks
export function MessageContent({ content }: { content: string }) {
  const parts = parseCodeBlocks(content);

  return (
    <div className="space-y-4">
      {parts.map((part, index) => (
        part.type === 'code' ? (
          <CodeBlock key={index} code={part.content} language={part.language} />
        ) : (
          <div 
            key={index} 
            className="prose prose-invert prose-sm max-w-none text-[#A3A3A3] leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(part.content) }}
          />
        )
      ))}
    </div>
  );
}
