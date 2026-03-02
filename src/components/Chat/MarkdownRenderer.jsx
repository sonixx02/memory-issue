import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';
import { tv } from '../../theme/ThemeContext.jsx';

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
 */
export default function MarkdownRenderer({ content }) {
  if (!content) return null;

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
