import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { tv } from '../../theme/ThemeContext.jsx';

// ── Animated typing indicator (replaces '...' placeholder) ──
export function TypingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '22px' }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="typing-dot"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

// ── Collapsible reasoning/thinking block ──
function ThinkingBlock({ content, isPartial }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{
      margin: '0 0 12px',
      borderRadius: '10px',
      border: `1px solid ${tv('--border')}`,
      overflow: 'hidden',
      backgroundColor: tv('--bg-secondary'),
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '7px',
          padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
          color: tv('--text-secondary'), fontSize: '12px', fontWeight: '500',
          textAlign: 'left',
        }}
      >
        <Brain size={13} style={{ flexShrink: 0, color: tv('--accent') }} />
        <span style={{ flex: 1 }}>
          {isPartial ? 'Thinking…' : 'Reasoning'}
        </span>
        {isPartial ? (
          <TypingDots />
        ) : (
          open ? <ChevronDown size={13} /> : <ChevronRight size={13} />
        )}
      </button>
      {(open || isPartial) && (
        <div style={{
          padding: '0 12px 12px',
          fontSize: '12.5px',
          lineHeight: 1.7,
          color: tv('--text-muted'),
          whiteSpace: 'pre-wrap',
          borderTop: `1px solid ${tv('--border')}40`,
          maxHeight: '400px',
          overflowY: 'auto',
        }} className="code-scroll">
          {content}
        </div>
      )}
    </div>
  );
}

/**
 * Extract thinking/reasoning blocks from content.
 * Catches:
 *  1. XML tags: <think>...</think> or <thinking>...</thinking>
 *  2. Inline text: (thinking) ...\n\n  or  (thought process) ...\n\n
 *
 * Returns { blocks: string[], mainContent: string, isPartial: boolean }
 */
function parseThinkingBlocks(content) {
  const blocks = [];

  // 1) Extract complete XML <think> / <thinking> blocks
  const xmlRe = /<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/gi;
  let mainContent = content.replace(xmlRe, (_, inner) => {
    blocks.push(inner.trim());
    return '';
  }).trim();

  // 2) Handle unclosed XML block (still streaming)
  const openXmlRe = /<(?:think|thinking)>([\s\S]*)$/i;
  const openMatch = openXmlRe.exec(mainContent);
  if (openMatch) {
    blocks.push(openMatch[1]);
    mainContent = mainContent.replace(openXmlRe, '').trim();
    return { blocks, mainContent, isPartial: true };
  }

  // 3) Catch literal text patterns: (thinking) ..., (thought process) ..., (reasoning) ...
  //    These appear at the START of a response. Split by paragraphs and detect where
  //    the real response begins (paragraph that doesn't read like internal reasoning).
  if (blocks.length === 0) {
    const parenRe = /^\((?:thinking|thought(?:\s+process)?|reasoning|chain\s+of\s+thought)\)\s*/i;
    const parenMatch = mainContent.match(parenRe);
    if (parenMatch) {
      const afterPrefix = mainContent.slice(parenMatch[0].length);
      const parts = afterPrefix.split(/\n\n/);
      let splitIdx = -1;

      for (let i = 1; i < parts.length; i++) {
        const p = parts[i].trimStart();
        // Internal-reasoning paragraphs typically start with these patterns
        const looksLikeReasoning = /^(I |The user|My |This means|That |There |Note:|Since |Given |However|Looking|Also |Now |We |From |Could |Should |Would |Need |Want |Let me)/i.test(p);
        if (!looksLikeReasoning && p.length > 0) {
          splitIdx = i;
          break;
        }
      }

      if (splitIdx > 0) {
        blocks.push(parts.slice(0, splitIdx).join('\n\n').trim());
        mainContent = parts.slice(splitIdx).join('\n\n').trim();
      } else if (parts.length > 1) {
        // No clear split — first paragraph is thinking, rest is response
        blocks.push(parts[0].trim());
        mainContent = parts.slice(1).join('\n\n').trim();
      }

      // Still streaming: whole content is reasoning, no response yet
      if (blocks.length > 0 && !mainContent) {
        return { blocks, mainContent, isPartial: true };
      }
    }
  }

  return { blocks, mainContent, isPartial: false };
}

// ── Custom dark theme based on oneDark with tweaks ──
const codeTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: 'transparent',
    margin: 0,
    padding: 0,
    fontSize: '13px',
    lineHeight: '1.6',
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: 'transparent',
    fontSize: '13px',
    lineHeight: '1.6',
  },
};

// ── Language label map ──
const LANG_LABELS = {
  js: 'JavaScript', javascript: 'JavaScript',
  ts: 'TypeScript', typescript: 'TypeScript',
  jsx: 'JSX', tsx: 'TSX',
  py: 'Python', python: 'Python',
  rb: 'Ruby', ruby: 'Ruby',
  go: 'Go', rust: 'Rust', rs: 'Rust',
  java: 'Java', kotlin: 'Kotlin', kt: 'Kotlin',
  swift: 'Swift', c: 'C', cpp: 'C++',
  cs: 'C#', csharp: 'C#',
  php: 'PHP', sql: 'SQL',
  html: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass',
  json: 'JSON', xml: 'XML', yaml: 'YAML', yml: 'YAML',
  md: 'Markdown', markdown: 'Markdown',
  bash: 'Bash', sh: 'Shell', shell: 'Shell', zsh: 'Zsh',
  powershell: 'PowerShell', ps1: 'PowerShell',
  dockerfile: 'Dockerfile', docker: 'Dockerfile',
  graphql: 'GraphQL', toml: 'TOML',
  ini: 'INI', diff: 'Diff', plaintext: 'Text', text: 'Text',
};

function getLangLabel(lang) {
  if (!lang) return 'Code';
  return LANG_LABELS[lang.toLowerCase()] || lang.toUpperCase();
}

// ── Copy button for code blocks ──
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy code'}
      style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        background: 'none', border: 'none',
        color: copied ? '#4ade80' : 'rgba(255,255,255,0.5)',
        fontSize: '11px', cursor: 'pointer', padding: '2px 6px',
        borderRadius: '4px', transition: 'all 0.15s',
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ── Code block with header, syntax highlighting, and copy ──
function CodeBlock({ language, children }) {
  const codeString = String(children).replace(/\n$/, '');

  return (
    <div style={{
      borderRadius: '10px',
      overflow: 'hidden',
      margin: '12px 0',
      border: '1px solid rgba(255,255,255,0.08)',
      backgroundColor: '#1e1e2e',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{
          fontSize: '11px', fontWeight: '500',
          color: 'rgba(255,255,255,0.45)',
          textTransform: 'none', letterSpacing: '0.02em',
        }}>
          {getLangLabel(language)}
        </span>
        <CopyButton text={codeString} />
      </div>

      {/* Code body with syntax highlighting */}
      <div style={{
        overflowX: 'auto',
        overflowY: 'auto',
        maxHeight: '500px',
        padding: '14px 16px',
        /* Custom scrollbar styling via className below */
      }} className="code-scroll">
        <SyntaxHighlighter
          style={codeTheme}
          language={language || 'text'}
          PreTag="div"
          customStyle={{
            margin: 0, padding: 0,
            background: 'transparent',
            fontSize: '13px',
            lineHeight: '1.6',
          }}
          codeTagProps={{
            style: {
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
              fontSize: '13px',
            },
          }}
          showLineNumbers={codeString.split('\n').length > 5}
          lineNumberStyle={{
            minWidth: '2.5em',
            paddingRight: '16px',
            color: 'rgba(255,255,255,0.15)',
            fontSize: '11px',
            userSelect: 'none',
          }}
          wrapLines={false}
          wrapLongLines={false}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

// ── Inline code ──
function InlineCode({ children }) {
  return (
    <code style={{
      backgroundColor: tv('--bg-tertiary'),
      padding: '2px 7px',
      borderRadius: '5px',
      fontSize: '12.5px',
      color: tv('--text-accent') || '#e879f9',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      border: `1px solid ${tv('--border')}`,
    }}>
      {children}
    </code>
  );
}

// ── Main component map for ReactMarkdown ──
const markdownComponents = {
  // Code blocks: detect fenced (``` ... ```) vs inline (`code`)
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const lang = match ? match[1] : null;

    // For react-markdown v9+, `inline` may not be passed. Detect by checking
    // if the parent is a <pre> tag.  react-markdown wraps fenced code in <pre><code>.
    const isInline = inline !== undefined ? inline : !node?.properties?.className;

    if (!isInline && (lang || String(children).includes('\n'))) {
      return <CodeBlock language={lang} children={children} />;
    }
    return <InlineCode>{children}</InlineCode>;
  },

  // Paragraphs
  p({ children }) {
    return <p style={{ margin: '0 0 12px', lineHeight: 1.8, wordBreak: 'break-word' }}>{children}</p>;
  },

  // Headings
  h1({ children }) {
    return <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '20px 0 10px', color: tv('--text-primary'), borderBottom: `1px solid ${tv('--border')}`, paddingBottom: '8px' }}>{children}</h1>;
  },
  h2({ children }) {
    return <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '18px 0 8px', color: tv('--text-primary'), borderBottom: `1px solid ${tv('--border')}`, paddingBottom: '6px' }}>{children}</h2>;
  },
  h3({ children }) {
    return <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '16px 0 6px', color: tv('--text-primary') }}>{children}</h3>;
  },
  h4({ children }) {
    return <h4 style={{ fontSize: '14px', fontWeight: '600', margin: '14px 0 4px', color: tv('--text-primary') }}>{children}</h4>;
  },

  // Links
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: tv('--accent'), textDecoration: 'none', borderBottom: `1px solid ${tv('--accent')}40`, transition: 'border-color 0.15s' }}
      >
        {children}
      </a>
    );
  },

  // Lists
  ul({ children }) {
    return <ul style={{ margin: '8px 0', paddingLeft: '22px', listStyleType: 'disc' }}>{children}</ul>;
  },
  ol({ children }) {
    return <ol style={{ margin: '8px 0', paddingLeft: '22px', listStyleType: 'decimal' }}>{children}</ol>;
  },
  li({ children }) {
    return <li style={{ marginBottom: '4px', lineHeight: 1.7, color: tv('--text-primary') }}>{children}</li>;
  },

  // Bold & italic
  strong({ children }) {
    return <strong style={{ color: tv('--text-primary'), fontWeight: '600' }}>{children}</strong>;
  },
  em({ children }) {
    return <em style={{ color: tv('--text-secondary'), fontStyle: 'italic' }}>{children}</em>;
  },

  // Blockquotes
  blockquote({ children }) {
    return (
      <blockquote style={{
        borderLeft: `3px solid ${tv('--accent')}`,
        margin: '12px 0',
        padding: '8px 16px',
        backgroundColor: tv('--bg-secondary'),
        borderRadius: '0 8px 8px 0',
        color: tv('--text-secondary'),
        fontStyle: 'italic',
      }}>
        {children}
      </blockquote>
    );
  },

  // Horizontal rule
  hr() {
    return <hr style={{ border: 'none', borderTop: `1px solid ${tv('--border')}`, margin: '16px 0' }} />;
  },

  // Tables
  table({ children }) {
    return (
      <div style={{ overflowX: 'auto', margin: '12px 0', borderRadius: '8px', border: `1px solid ${tv('--border')}` }} className="code-scroll">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return <thead style={{ backgroundColor: tv('--bg-tertiary') }}>{children}</thead>;
  },
  tbody({ children }) {
    return <tbody>{children}</tbody>;
  },
  tr({ children }) {
    return <tr style={{ borderBottom: `1px solid ${tv('--border')}` }}>{children}</tr>;
  },
  th({ children }) {
    return (
      <th style={{
        padding: '8px 14px', textAlign: 'left', fontWeight: '600',
        color: tv('--text-primary'), fontSize: '12px',
        borderBottom: `2px solid ${tv('--border')}`,
        whiteSpace: 'nowrap',
      }}>
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td style={{
        padding: '8px 14px', color: tv('--text-secondary'),
        lineHeight: 1.5, verticalAlign: 'top',
      }}>
        {children}
      </td>
    );
  },

  // Images
  img({ src, alt }) {
    return (
      <img
        src={src}
        alt={alt || ''}
        style={{
          maxWidth: '100%',
          borderRadius: '8px',
          margin: '8px 0',
          border: `1px solid ${tv('--border')}`,
        }}
        loading="lazy"
      />
    );
  },

  // Pre — pass through (CodeBlock handles styling)
  pre({ children }) {
    return <>{children}</>;
  },
};

/**
 * Renders markdown content with syntax-highlighted code blocks,
 * proper tables, blockquotes, and polished typography.
 *
 * Special cases:
 * - content === '...' → animated typing dots (waiting for first token)
 * - content contains <think> blocks → collapsible reasoning section
 */
export default function MarkdownRenderer({ content }) {
  if (!content) return null;

  // Waiting for first token — show animated dots
  if (content === '...') return <TypingDots />;

  const { blocks, mainContent, isPartial } = parseThinkingBlocks(content);

  return (
    <div className="markdown-body">
      {blocks.map((block, i) => (
        <ThinkingBlock key={i} content={block} isPartial={isPartial && i === blocks.length - 1} />
      ))}
      {mainContent && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={markdownComponents}
        >
          {mainContent}
        </ReactMarkdown>
      )}
    </div>
  );
}
