import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: 'Arial, sans-serif',
          background: '#f8fafc',
          color: '#03234b',
        }}>
          <div style={{ maxWidth: 520, textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>页面加载失败</h1>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1rem' }}>
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => {
                try { localStorage.removeItem('geo-campaign-storage'); } catch { /* ignore */ }
                window.location.reload();
              }}
              style={{
                background: '#ffd200',
                color: '#03234b',
                border: 'none',
                borderRadius: 8,
                padding: '10px 18px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              清除缓存并刷新
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
