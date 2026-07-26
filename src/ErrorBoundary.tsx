import { Component, type ErrorInfo, type ReactNode } from 'react'

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
    return <main className="fatal-error" role="alert">
      <div className="panel">
        <p className="eyebrow">Unerwarteter Fehler</p>
        <h1>Finance Planner konnte nicht weiterlaufen.</h1>
        <p>Deine lokal gespeicherten Daten wurden nicht automatisch gelöscht. Lade die Seite neu. Falls der Fehler bleibt, exportiere die Browserdaten nicht manuell und melde den Fehler mit den letzten Schritten.</p>
        <button className="primary" onClick={() => window.location.reload()}>App neu laden</button>
      </div>
    </main>
  }
}
