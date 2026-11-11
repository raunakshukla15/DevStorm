import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TerraPulse UI boundary caught error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#060b16] text-white flex items-center justify-center p-6">
          <div className="max-w-md bg-[#0c1424] border border-red-500/30 rounded-xl p-6 space-y-3">
            <h1 className="text-lg font-semibold text-red-300">Something went wrong</h1>
            <p className="text-sm text-white/70">{this.state.message || 'Unexpected rendering error.'}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="bg-blue-600 hover:bg-blue-500 text-sm font-medium rounded-lg px-4 py-2"
            >
              Reload application
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
