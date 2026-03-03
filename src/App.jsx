import './App.css';
import { Component } from 'react';
import AppShell from './components/Layout/AppShell.jsx';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import LoginScreen from './auth/LoginScreen.jsx';

// Error boundary to catch & display runtime crashes instead of white screen
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(err, info) { console.error('App crash:', err, info); }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 40, color: '#f87171', fontFamily: 'monospace', background: '#0a0a0a', minHeight: '100vh' }}>
        <h2>Something went wrong</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{this.state.error.message}</pre>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#888', marginTop: 12 }}>{this.state.error.stack}</pre>
        <button onClick={() => { localStorage.removeItem('synapse-user'); window.location.reload(); }}
          style={{ marginTop: 20, padding: '8px 16px', background: '#f87171', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          Clear session &amp; reload
        </button>
      </div>
    );
    return this.props.children;
  }
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary, #0a0a0a)', color: '#888' }}>
      Loading…
    </div>
  );

  if (!user) return <LoginScreen />;

  return <AppShell />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App
