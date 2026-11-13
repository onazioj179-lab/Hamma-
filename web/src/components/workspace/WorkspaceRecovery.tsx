import { Component, type ErrorInfo, type ReactNode } from 'react';

export class WorkspaceRecovery extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private attempted = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Workspace render failed', error, info.componentStack);
    if (this.attempted) return;
    this.attempted = true;
    this.retry = setTimeout(() => this.setState({ failed: false }), 0);
  }

  componentWillUnmount() {
    clearTimeout(this.retry);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (!this.attempted) return null;
    return <main className="processor-notice" role="status">
      <span>Workspace unavailable</span>
      <button className="button secondary" onClick={() => this.setState({ failed: false })}>Reopen workspace</button>
    </main>;
  }
}
