import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAuthStatus } from '../api/auth'
import { Card } from '../components/Card'
import { usePrefsStore } from '../store/usePrefsStore'
import { HAZARDS, REGIONS } from '../utils/geo'

export default function Settings() {
  const [tab, setTab] = useState('sources')
  const prefs = usePrefsStore((s) => s.prefs)
  const setPrefs = usePrefsStore((s) => s.setPrefs)

  const authQuery = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    retry: 1,
  })

  const auth = authQuery.data ?? (authQuery.isError ? { connected: false, timestamp: '', note: 'Backend unreachable.' } : null)

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold">Settings &amp; Data Sources</h1>
      <div className="flex gap-2">
        {[
          ['sources', 'Data Sources'],
          ['processing', 'Processing'],
          ['account', 'Account'],
          ['preferences', 'Preferences'],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            onClick={() => setTab(id)}
            className={`text-sm rounded-lg px-4 py-1.5 ${
              tab === id ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/65'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'sources' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="NASA Earthdata (ASF DAAC)">
            <p>L-band NISAR data through NASA Earthdata.</p>
            <p className="text-xs">
              Status check: {auth ? (auth.connected ? 'Connected' : 'Failed') : '…'}
              {auth?.timestamp ? ` · ${auth.timestamp.slice(0, 19).replace('T', ' ')} UTC` : ''}
            </p>
            {auth && !auth.connected && <p className="text-amber-200 text-xs">{auth.note}</p>}
            <button
              type="button"
              onClick={() => void authQuery.refetch()}
              disabled={authQuery.isFetching}
              className="text-sm border border-cyan-500/50 text-cyan-300 rounded-lg px-3 py-1.5 disabled:opacity-50"
            >
              {authQuery.isFetching ? 'Testing…' : 'Test Connection'}
            </button>
          </Card>
          <Card title="ISRO Bhoonidhi (S-band)">
            <p>S-band NISAR data is served by ISRO through Bhoonidhi — not integrated in this build.</p>
            <p className="text-xs text-white/50">Status: not configured (L-band only).</p>
          </Card>
        </div>
      )}
      {tab === 'processing' && (
        <Card title="Processing Settings">
          <label className="flex items-center justify-between gap-4">
            Auto-dates by default (newest pair)
            <input
              type="checkbox"
              checked={prefs.autoDates !== false}
              onChange={(e) => setPrefs({ autoDates: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            Default hazard
            <select
              value={prefs.defaultHazard}
              onChange={(e) => setPrefs({ defaultHazard: e.target.value })}
              className="bg-white/10 rounded px-2 py-1"
            >
              {HAZARDS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-white/45">Saved in this browser and applied across pages.</p>
        </Card>
      )}
      {tab === 'account' && (
        <Card title="Account">
          <p>
            Earthdata credentials live only in <span className="text-white">backend/.env</span> on this
            machine — never in the app or git.
          </p>
          <p className="text-xs">
            Configured:{' '}
            {auth
              ? auth.connected
                ? 'yes (verified just now)'
                : 'no / invalid — see note above'
              : 'checking…'}
          </p>
        </Card>
      )}
      {tab === 'preferences' && (
        <Card title="Map Preferences">
          <label className="flex items-center justify-between gap-4">
            Default region
            <select
              value={prefs.defaultRegion}
              onChange={(e) => setPrefs({ defaultRegion: e.target.value })}
              className="bg-white/10 rounded px-2 py-1"
            >
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-4">
            Default base layer
            <select
              value={prefs.baseLayer}
              onChange={(e) => setPrefs({ baseLayer: e.target.value === 'osm' ? 'osm' : 'esri' })}
              className="bg-white/10 rounded px-2 py-1"
            >
              <option value="esri">Satellite</option>
              <option value="osm">Streets</option>
            </select>
          </label>
        </Card>
      )}
    </div>
  )
}
