import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props { children: ReactNode }
interface State { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Finance Planner crashed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    // Deliberately no stack trace, error message, or other diagnostic detail
    // rendered here -- that information goes to console.error above, not the
    // DOM. This must render correctly even when nothing else in the app
    // (including RuntimeSurfaceCoordinator, FrontendExperience, etc.) has
    // mounted, since a crash can happen before or during their own render.
    return <main className="fatal-error" role="alert" lang="en">
      <div className="panel warning-card">
        <div className="goal-hero-icon" aria-hidden="true"><AlertTriangle size={22}/></div>
        <p className="eyebrow">Unexpected error</p>
        <h1>Finance Planner couldn't continue.</h1>
        <p>Your locally stored data was not automatically deleted. Reloading the page is safe. If the problem continues, note what you were doing and report it.</p>
        <button className="primary" onClick={() => window.location.reload()}>Reload Finance Planner</button>
      </div>
    </main>
  }
}
