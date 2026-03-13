import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { initDb } from '../db/database.js';

const AuthContext = createContext(null);

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_ID; 

/**
 * AuthProvider — manages Google Sign-In state.
 *
 * Uses Google Identity Services (GSI) loaded via script tag in index.html.
 * Falls back to guest mode (no account required) — fully local-first.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);      // { id, name, email, picture }
  const [loading, setLoading] = useState(true);
  const [gsiReady, setGsiReady] = useState(false);

  // Restore session from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('synapse-user') || localStorage.getItem('snapshot-ai-user');
      if (stored) {
        const parsed = JSON.parse(stored);
        initDb(parsed.id);          // switch to per-user DB
        setUser(parsed);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // Wait for GSI script to load
  useEffect(() => {
    const check = () => {
      if (window.google?.accounts?.id) {
        setGsiReady(true);
        return true;
      }
      return false;
    };
    if (check()) return;
    const interval = setInterval(() => {
      if (check()) clearInterval(interval);
    }, 200);
    const timeout = setTimeout(() => clearInterval(interval), 10000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, []);

  // Initialize GSI when ready
  useEffect(() => {
    if (!gsiReady) return;
    const clientId = localStorage.getItem('synapse-google-client-id') || GOOGLE_CLIENT_ID;
    if (!clientId) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      auto_select: true,
    });
  }, [gsiReady]);

  const handleCredentialResponse = useCallback((response) => {
    try {
      const payload = decodeJwtPayload(response.credential);
      const userData = {
        id: payload.sub,
        name: payload.name || payload.email,
        email: payload.email,
        picture: payload.picture || null,
      };
      setUser(userData);
      initDb(userData.id);            // switch to per-user DB
      localStorage.setItem('synapse-user', JSON.stringify(userData));
    } catch (err) {
      console.error('Google sign-in failed:', err);
    }
  }, []);

  const signIn = useCallback(() => {
    const clientId = localStorage.getItem('synapse-google-client-id') || GOOGLE_CLIENT_ID;
    if (!clientId) {
      alert('Please set your Google Client ID in Settings first.');
      return;
    }
    if (!gsiReady) {
      alert('Google Sign-In is still loading. Please try again.');
      return;
    }
    // Re-initialize with latest client ID
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
    });
    window.google.accounts.id.prompt();
  }, [gsiReady, handleCredentialResponse]);

  const signOut = useCallback(() => {
    setUser(null);
    localStorage.removeItem('synapse-user');
    localStorage.removeItem('snapshot-ai-user'); // clean up legacy
    if (gsiReady) {
      try { window.google.accounts.id.disableAutoSelect(); } catch { /* ok */ }
    }
  }, [gsiReady]);

  const continueAsGuest = useCallback(() => {
    const guestUser = {
      id: 'guest',
      name: 'Guest',
      email: null,
      picture: null,
    };
    initDb(guestUser.id);             // use default 'SnapshotAI' DB
    setUser(guestUser);
    localStorage.setItem('synapse-user', JSON.stringify(guestUser));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, continueAsGuest, gsiReady }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Decode the payload of a JWT without verification (client-side only).
 * Google's credential response is a JWT — we extract user info from it.
 */
function decodeJwtPayload(token) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(json);
}
