import { Suspense, lazy } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { Skeleton } from './components/Skeleton'
import 'leaflet/dist/leaflet.css'
import './index.css'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const ExploreMap = lazy(() => import('./pages/ExploreMap'))
const ChangeAnalysis = lazy(() => import('./pages/ChangeAnalysis'))
const TimeSeries = lazy(() => import('./pages/TimeSeries'))
const CompareJobs = lazy(() => import('./pages/CompareJobs'))
const Events = lazy(() => import('./pages/Events'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Reports = lazy(() => import('./pages/Reports'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Methodology = lazy(() => import('./pages/Methodology'))
const Settings = lazy(() => import('./pages/Settings'))
const ResultDetail = lazy(() => import('./pages/ResultDetail'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      refetchOnWindowFocus: false,
    },
  },
})

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-44" />
      <Skeleton className="h-44" />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Layout>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/explore" element={<ExploreMap />} />
                <Route path="/change" element={<ChangeAnalysis />} />
                <Route path="/change-detection" element={<ChangeAnalysis />} />
                <Route path="/timeseries" element={<TimeSeries />} />
                <Route path="/compare" element={<CompareJobs />} />
                <Route path="/events" element={<Events />} />
                <Route path="/catalog" element={<Catalog />} />
                <Route path="/data-explorer" element={<Catalog />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/methodology" element={<Methodology />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/results/:jobId" element={<ResultDetail />} />
                <Route path="/about" element={<Methodology />} />
                <Route path="/locations" element={<Events />} />
              </Routes>
            </Suspense>
          </Layout>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
