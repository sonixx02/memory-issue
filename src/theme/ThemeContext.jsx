import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSetting, setSetting } from '../db/settingsHelpers.js';

// ── Theme Presets ──
export const THEMES = {
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep blue-violet dark theme',
    preview: ['#0b0f1a', '#141b2d', '#6366f1', '#818cf8'],
    vars: {
      '--bg-primary':    '#0b0f1a',
      '--bg-secondary':  '#111827',
      '--bg-tertiary':   '#1e293b',
      '--bg-hover':      '#1e293b',
      '--bg-active':     '#1e3a5f',
      '--bg-input':      '#0f172a',
      '--bg-surface':    '#141b2d',
      '--border':        '#1e293b',
      '--border-focus':  '#6366f1',
      '--text-primary':  '#f1f5f9',
      '--text-secondary':'#94a3b8',
      '--text-muted':    '#475569',
      '--text-accent':   '#818cf8',
      '--accent':        '#6366f1',
      '--accent-hover':  '#4f46e5',
      '--accent-soft':   '#6366f115',
      '--success':       '#34d399',
      '--success-soft':  '#34d39915',
      '--warning':       '#fbbf24',
      '--warning-soft':  '#fbbf2415',
      '--error':         '#f87171',
      '--error-soft':    '#f8717115',
      '--purple':        '#a78bfa',
      '--purple-soft':   '#a78bfa15',
      '--scrollbar':     '#1e293b',
      '--scrollbar-hover':'#334155',
      '--shadow':        'rgba(0,0,0,0.4)',
    },
  },
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Pure dark with sharp contrasts',
    preview: ['#09090b', '#18181b', '#a855f7', '#c084fc'],
    vars: {
      '--bg-primary':    '#09090b',
      '--bg-secondary':  '#18181b',
      '--bg-tertiary':   '#27272a',
      '--bg-hover':      '#27272a',
      '--bg-active':     '#3f3f46',
      '--bg-input':      '#0f0f12',
      '--bg-surface':    '#18181b',
      '--border':        '#27272a',
      '--border-focus':  '#a855f7',
      '--text-primary':  '#fafafa',
      '--text-secondary':'#a1a1aa',
      '--text-muted':    '#52525b',
      '--text-accent':   '#c084fc',
      '--accent':        '#a855f7',
      '--accent-hover':  '#9333ea',
      '--accent-soft':   '#a855f715',
      '--success':       '#4ade80',
      '--success-soft':  '#4ade8015',
      '--warning':       '#facc15',
      '--warning-soft':  '#facc1515',
      '--error':         '#f87171',
      '--error-soft':    '#f8717115',
      '--purple':        '#c084fc',
      '--purple-soft':   '#c084fc15',
      '--scrollbar':     '#27272a',
      '--scrollbar-hover':'#3f3f46',
      '--shadow':        'rgba(0,0,0,0.6)',
    },
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora',
    description: 'Dark with emerald green accents',
    preview: ['#0a0f0d', '#0f1a16', '#10b981', '#6ee7b7'],
    vars: {
      '--bg-primary':    '#0a0f0d',
      '--bg-secondary':  '#0f1a16',
      '--bg-tertiary':   '#162b22',
      '--bg-hover':      '#162b22',
      '--bg-active':     '#1a3a2a',
      '--bg-input':      '#0b120f',
      '--bg-surface':    '#0f1a16',
      '--border':        '#162b22',
      '--border-focus':  '#10b981',
      '--text-primary':  '#ecfdf5',
      '--text-secondary':'#86efac',
      '--text-muted':    '#4b7a62',
      '--text-accent':   '#6ee7b7',
      '--accent':        '#10b981',
      '--accent-hover':  '#059669',
      '--accent-soft':   '#10b98115',
      '--success':       '#34d399',
      '--success-soft':  '#34d39915',
      '--warning':       '#fbbf24',
      '--warning-soft':  '#fbbf2415',
      '--error':         '#f87171',
      '--error-soft':    '#f8717115',
      '--purple':        '#a78bfa',
      '--purple-soft':   '#a78bfa15',
      '--scrollbar':     '#162b22',
      '--scrollbar-hover':'#1f3d2e',
      '--shadow':        'rgba(0,0,0,0.5)',
    },
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm tones with amber accents',
    preview: ['#120d08', '#1c1410', '#f59e0b', '#fcd34d'],
    vars: {
      '--bg-primary':    '#120d08',
      '--bg-secondary':  '#1c1410',
      '--bg-tertiary':   '#2d2117',
      '--bg-hover':      '#2d2117',
      '--bg-active':     '#3d2e1a',
      '--bg-input':      '#151009',
      '--bg-surface':    '#1c1410',
      '--border':        '#2d2117',
      '--border-focus':  '#f59e0b',
      '--text-primary':  '#fef3c7',
      '--text-secondary':'#d4a574',
      '--text-muted':    '#7a5c3a',
      '--text-accent':   '#fcd34d',
      '--accent':        '#f59e0b',
      '--accent-hover':  '#d97706',
      '--accent-soft':   '#f59e0b15',
      '--success':       '#34d399',
      '--success-soft':  '#34d39915',
      '--warning':       '#fbbf24',
      '--warning-soft':  '#fbbf2415',
      '--error':         '#f87171',
      '--error-soft':    '#f8717115',
      '--purple':        '#c4b5fd',
      '--purple-soft':   '#c4b5fd15',
      '--scrollbar':     '#2d2117',
      '--scrollbar-hover':'#3d2e1a',
      '--shadow':        'rgba(0,0,0,0.5)',
    },
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    description: 'Deep blue tones with cyan highlights',
    preview: ['#0a1019', '#0f1729', '#0ea5e9', '#67e8f9'],
    vars: {
      '--bg-primary':    '#0a1019',
      '--bg-secondary':  '#0f1729',
      '--bg-tertiary':   '#172554',
      '--bg-hover':      '#172554',
      '--bg-active':     '#1e3a5f',
      '--bg-input':      '#0c1322',
      '--bg-surface':    '#0f1729',
      '--border':        '#172554',
      '--border-focus':  '#0ea5e9',
      '--text-primary':  '#e0f2fe',
      '--text-secondary':'#7dd3fc',
      '--text-muted':    '#3b6d8f',
      '--text-accent':   '#67e8f9',
      '--accent':        '#0ea5e9',
      '--accent-hover':  '#0284c7',
      '--accent-soft':   '#0ea5e915',
      '--success':       '#34d399',
      '--success-soft':  '#34d39915',
      '--warning':       '#fbbf24',
      '--warning-soft':  '#fbbf2415',
      '--error':         '#f87171',
      '--error-soft':    '#f8717115',
      '--purple':        '#a5b4fc',
      '--purple-soft':   '#a5b4fc15',
      '--scrollbar':     '#172554',
      '--scrollbar-hover':'#1e3a5f',
      '--shadow':        'rgba(0,0,0,0.5)',
    },
  },
  rosePine: {
    id: 'rosePine',
    name: 'Rosé Pine',
    description: 'Muted rose and pine tones',
    preview: ['#191724', '#1f1d2e', '#eb6f92', '#c4a7e7'],
    vars: {
      '--bg-primary':    '#191724',
      '--bg-secondary':  '#1f1d2e',
      '--bg-tertiary':   '#26233a',
      '--bg-hover':      '#26233a',
      '--bg-active':     '#393552',
      '--bg-input':      '#1a1826',
      '--bg-surface':    '#1f1d2e',
      '--border':        '#26233a',
      '--border-focus':  '#c4a7e7',
      '--text-primary':  '#e0def4',
      '--text-secondary':'#908caa',
      '--text-muted':    '#6e6a86',
      '--text-accent':   '#c4a7e7',
      '--accent':        '#eb6f92',
      '--accent-hover':  '#d44e73',
      '--accent-soft':   '#eb6f9215',
      '--success':       '#9ccfd8',
      '--success-soft':  '#9ccfd815',
      '--warning':       '#f6c177',
      '--warning-soft':  '#f6c17715',
      '--error':         '#eb6f92',
      '--error-soft':    '#eb6f9215',
      '--purple':        '#c4a7e7',
      '--purple-soft':   '#c4a7e715',
      '--scrollbar':     '#26233a',
      '--scrollbar-hover':'#393552',
      '--shadow':        'rgba(0,0,0,0.4)',
    },
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState('midnight');
  const [loaded, setLoaded] = useState(false);

  // Load saved theme from DB
  useEffect(() => {
    getSetting('theme').then(saved => {
      if (saved && THEMES[saved]) setThemeId(saved);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // Apply CSS custom properties to :root
  useEffect(() => {
    if (!loaded) return;
    const theme = THEMES[themeId] || THEMES.midnight;
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    // Update scrollbar and body bg
    document.body.style.backgroundColor = theme.vars['--bg-primary'];
  }, [themeId, loaded]);

  const changeTheme = useCallback(async (id) => {
    if (THEMES[id]) {
      setThemeId(id);
      await setSetting('theme', id);
    }
  }, []);

  const theme = THEMES[themeId] || THEMES.midnight;

  return (
    <ThemeContext.Provider value={{ themeId, theme, changeTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

// Helper: get a CSS variable value for inline styles
export function tv(varName) {
  return `var(${varName})`;
}
