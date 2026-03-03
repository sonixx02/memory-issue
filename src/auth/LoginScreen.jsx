import { useState } from 'react';
import { Sparkles, User, LogIn } from 'lucide-react';
import { useAuth } from './AuthContext.jsx';
import { tv } from '../theme/ThemeContext.jsx';

export default function LoginScreen() {
  const { signIn, continueAsGuest, gsiReady } = useAuth();
  const [hoveredBtn, setHoveredBtn] = useState(null);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: tv('--bg-primary'), color: tv('--text-primary'),
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      padding: '24px',
    }}>
      {/* Logo */}
      <div style={{
        width: '72px', height: '72px', borderRadius: '20px',
        background: `linear-gradient(135deg, ${tv('--accent')} 0%, ${tv('--purple')} 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 8px 32px ${tv('--accent')}30`,
        marginBottom: '24px',
      }}>
        <Sparkles size={36} color="#fff" />
      </div>

      <h1 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: '700', letterSpacing: '-0.03em' }}>
        Synapse
      </h1>
      <p style={{ margin: '0 0 32px', fontSize: '15px', color: tv('--text-muted'), textAlign: 'center', maxWidth: '360px', lineHeight: 1.7 }}>
        Your personal AI assistant with persistent memory. Sign in to sync your data, or continue as a guest.
      </p>

      {/* Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '320px' }}>
        {/* Google Sign-In */}
        <button
          onClick={signIn}
          onMouseEnter={() => setHoveredBtn('google')}
          onMouseLeave={() => setHoveredBtn(null)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
            padding: '12px 20px', borderRadius: '12px', border: `1px solid ${tv('--border')}`,
            fontSize: '15px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit',
            backgroundColor: hoveredBtn === 'google' ? tv('--bg-hover') : tv('--bg-secondary'),
            color: tv('--text-primary'),
            transition: 'all 0.15s',
            opacity: gsiReady ? 1 : 0.5,
          }}
        >
          <GoogleIcon />
          Sign in with Google
        </button>

        {/* Guest */}
        <button
          onClick={continueAsGuest}
          onMouseEnter={() => setHoveredBtn('guest')}
          onMouseLeave={() => setHoveredBtn(null)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
            padding: '12px 20px', borderRadius: '12px', border: `1px solid ${tv('--border')}`,
            fontSize: '15px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit',
            backgroundColor: hoveredBtn === 'guest' ? tv('--bg-hover') : 'transparent',
            color: tv('--text-secondary'),
            transition: 'all 0.15s',
          }}
        >
          <User size={18} />
          Continue as Guest
        </button>
      </div>

      <p style={{ margin: '24px 0 0', fontSize: '12px', color: tv('--text-muted'), textAlign: 'center', maxWidth: '320px', lineHeight: 1.6 }}>
        All data is stored locally in your browser. Signing in creates a separate database for your account.
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
