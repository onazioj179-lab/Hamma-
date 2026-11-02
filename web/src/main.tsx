/**
 * Main Entry Point
 * Production-grade React initialization with Error Boundary
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MotionConfig } from 'framer-motion';
import './index.css';
import './workspace.css';
import './processing/controls.css';

// ============================================================================
// ERROR BOUNDARY - Prevents app crashes from propagating
// ============================================================================

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[SPK Error Boundary] Caught error:', error);
    console.error('[SPK Error Boundary] Component stack:', errorInfo.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    try {
      sessionStorage.removeItem('spk-compression-state');
    } catch {
      // Ignore storage errors
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 
                          flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            
            <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Something went wrong
            </h1>
            
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              The application encountered an unexpected error. Your files are safe.
            </p>
            
            <p className="recovery-note">Reopen the workspace to reconnect to saved jobs. Jobs on a running processor continue in the background.</p>

            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white 
                         rounded-xl font-semibold transition-colors"
              >
                Reopen workspace
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 
                         dark:hover:bg-gray-600 text-gray-800 dark:text-white 
                         rounded-xl font-semibold transition-colors"
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// THEME INITIALIZATION
// ============================================================================

// ============================================================================
// APP INITIALIZATION
// ============================================================================

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user"><App /></MotionConfig>
    </ErrorBoundary>
  </React.StrictMode>
);
