'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Clinical Error Boundary] Caught exception:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 'var(--space-6)',
          borderRadius: 'var(--radius-xl)',
          backgroundColor: '#fee2e2',
          border: '1px solid #fecaca',
          color: '#dc2626',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: '12px',
          minHeight: '220px',
          animation: 'fadeIn 0.3s ease-out',
          fontFamily: 'var(--font-family)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <AlertTriangle size={36} color="#dc2626" style={{ filter: 'drop-shadow(0 2px 4px rgba(220, 38, 38, 0.15))' }} />
          <div>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, margin: '0 0 4px 0', color: '#991b1b' }}>
              Subsystem Interrupted
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#7f1d1d', opacity: 0.8, maxWidth: '340px', margin: 0, lineHeight: 1.5 }}>
              A temporary glitch was intercepted in this clinical workspace. Patient record state is fully preserved.
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="btn btn-primary"
            style={{
              background: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
              borderColor: 'transparent',
              boxShadow: '0 4px 16px rgba(220, 38, 38, 0.25)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              borderRadius: 'var(--radius-md)',
              color: 'white',
              cursor: 'pointer',
              border: 'none',
              marginTop: '4px'
            }}
          >
            <RotateCcw size={14} /> Reconnect Subsystem
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
