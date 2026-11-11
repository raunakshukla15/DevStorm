import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchObservations } from '../api/observations'
import { Card } from '../components/Card'
import { Skeleton } from '../components/Skeleton'
import { REGIONS } from '../utils/geo'

export default function Catalog() {
  const [tab, setTab] = useState('all')
  const [region, setRegion] = useState('amazon')
  const [start, setStart] = useState('2026-08-01')
  const [end, setEnd] = useState('2026-10-14')
  const [submitted, setSubmitted] = useState({ region: 'amazon', start: '2026-08-01', end: '2026-10-14' })

  const activeRegion = REGIONS.find((x) => x.id === submitted.region) ?? REGIONS[0]

  const query = useQuery({
    queryKey: ['catalog', submitted.region, submitted.start, submitted.end],
    queryFn: () =>
      searchObservations({
        datasetId: 'nisar_l2_gcov',
        lat: activeRegion.lat,
        lon: activeRegion.lon,
        startDate: submitted.start,
        endDate: submitted.end,
      }),
    enabled: tab !== 'sband' && tab !== 'insar',
    retry: 1,
  })

  const levelOf = (sn: string) => (sn.includes('GCOV') ? 'L2' : sn.includes('RSLC') ? 'L1' : '—')
  const rows = query.data ?? []

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Data Catalog</h1>
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'all', label: 'All Products' },
          { id: 'lband', label: 'L-band (NASA)' },
          { id: 'sband', label: 'S-band (ISRO)' },
          { id: 'insar', label: 'InSAR' },
          { id: 'surface', label: 'Surface Change' },
        ].map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-sm rounded-full px-4 py-1.5 ${
              tab === t.id ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'sband' || tab === 'insar' ? (
        <Card title={tab === 'sband' ? 'S-band (ISRO Bhoonidhi)' : 'InSAR products'}>
          <p>
            {tab === 'sband'
              ? 'NISAR S-band data is served by ISRO through the Bhoonidhi portal — this catalog only queries the NASA L-band archive, so no rows are shown rather than invented ones.'
              : 'Interferometric deformation products need RSLC / InSAR processing, which TerraPulse does not stream yet. The catalog lists the GCOV backscatter products actually used.'}
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-end bg-[#0c1424] border border-white/10 rounded-xl p-4">
            <label className="text-xs">
              Region{' '}
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="ml-1 bg-white/10 rounded px-2 py-1.5"
              >
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              From{' '}
              <input
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="ml-1 w-28 bg-white/10 rounded px-2 py-1.5"
              />
            </label>
            <label className="text-xs">
              To{' '}
              <input
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="ml-1 w-28 bg-white/10 rounded px-2 py-1.5"
              />
            </label>
            <button
              type="button"
              onClick={() => setSubmitted({ region, start, end })}
              disabled={query.isFetching}
              className="text-sm bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-1.5 font-medium disabled:opacity-50"
            >
              {query.isFetching ? 'Searching live catalog…' : 'Search'}
            </button>
          </div>
          {query.isError && <p className="text-red-300 text-sm">{query.error.message}</p>}
          {query.isLoading && <Skeleton className="h-32" />}
          {!query.isError && !query.isLoading && rows.length === 0 && (
            <Card title="No products">
              <p>No live granules match — widen the dates or pick another region.</p>
            </Card>
          )}
          {rows.length > 0 && (
            <div className="bg-[#0c1424] border border-white/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/50 text-xs border-b border-white/10">
                    <th className="p-3">Product</th>
                    <th className="p-3">Band</th>
                    <th className="p-3">Level</th>
                    <th className="p-3">Acquired</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => (
                    <tr key={g.id ?? g.title ?? g.acquisition_date} className="border-b border-white/5">
                      <td className="p-3">
                        <p className="text-white break-all">{(g.title ?? '').slice(0, 42)}…</p>
                        <p className="text-xs text-white/40">{g.short_name}</p>
                      </td>
                      <td className="p-3">L-band</td>
                      <td className="p-3">{levelOf(g.short_name ?? '')}</td>
                      <td className="p-3">{g.acquisition_date ?? '—'}</td>
                      <td className="p-3">
                        {g.https_url && (
                          <a
                            href={g.https_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-300 underline text-xs"
                          >
                            Download
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
