'use client';

import React from 'react';

type PasswordGateProps = {
  folderName: string;
  password: string;
  loading: boolean;
  error: string;
  onPasswordChange: (value: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
};

export default function PasswordGate({
  folderName,
  password,
  loading,
  error,
  onPasswordChange,
  onSubmit,
}: PasswordGateProps) {
  return (
    <section style={styles.shell}>
      <div style={styles.card}>
        <p style={styles.brand}>AYXA</p>
        <p style={styles.folder}>Shared Folder: {folderName || 'Shared Space'}</p>
        <p style={styles.subtitle}>Enter password to access this shared space</p>

        <form onSubmit={onSubmit} style={{ marginTop: 8 }}>
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
            style={styles.input}
          />
          <button type="submit" disabled={loading} style={{ ...styles.button, opacity: loading ? 0.8 : 1 }}>
            {loading ? 'Unlocking...' : 'Unlock Folder'}
          </button>
        </form>

        {!!error && <p style={styles.error}>{error}</p>}
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 20,
    background:
      'radial-gradient(1200px 550px at 90% -10%, rgba(109,167,255,0.2), transparent 60%), radial-gradient(900px 550px at -10% 110%, rgba(59,130,246,0.18), transparent 60%), linear-gradient(140deg, #02050d, #071325 45%, #0e2445)',
  },
  card: {
    width: 'min(480px, 100%)',
    borderRadius: 24,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.08)',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 30px 70px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.1)',
    padding: '34px 28px 28px',
    color: '#fff',
  },
  brand: { margin: 0, textAlign: 'center', fontSize: 30, letterSpacing: '0.18em', fontWeight: 800 },
  folder: { margin: '8px 0 0', textAlign: 'center', color: 'rgba(219,232,255,0.8)', wordBreak: 'break-word' },
  subtitle: { margin: '18px 0 0', textAlign: 'center', color: 'rgba(219,232,255,0.8)', fontSize: 15 },
  input: {
    width: '100%',
    height: 50,
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(0,0,0,0.28)',
    color: '#fff',
    padding: '0 14px',
    fontSize: 15,
    outline: 'none',
  },
  button: {
    marginTop: 12,
    width: '100%',
    height: 48,
    border: 'none',
    borderRadius: 14,
    cursor: 'pointer',
    color: '#03122a',
    fontWeight: 700,
    fontSize: 15,
    background: 'linear-gradient(135deg,#86b8ff,#5a95ff)',
    boxShadow: '0 14px 30px rgba(87,146,255,0.35)',
  },
  error: { marginTop: 12, color: '#ffb0b0', textAlign: 'center', fontSize: 13 },
};
