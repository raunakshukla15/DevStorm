import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { discoverNisarCollections } from '../api/datasets'
import { searchObservations } from '../api/observations'
import { Card } from '../components/Card'
import { Skeleton } from '../components/Skeleton'
import { REGIONS } from '../utils/geo'

export default function Catalog() {
  const [tab, setTab] = useState('all')
  const [region, setRegion] = useState('amazon')
  const [start, setStart] = useState('2026-08-01')
  const [end, setEnd] = useState('2026-11-15')
  const [submitted, setSubmitted] = useState({ region: 'amazon', start: '2026-08-01', end: '2026-11-15' })

  const activeRegion = REGIONS.find((x) => x.id === submitted.region) ?? REGIONS[0]
  const datasetForTab = tab === 'insar' ? 'nisar_l2_gunw' : 'nisar_l2_gcov'

  const query = useQuery({
    queryKey: ['catalog', datasetForTab, submitted.region, submitted.start, submitted.end],
    queryFn: () =>
      searchObservations({
        datasetId: datasetForTab,
        lat: activeRegion.lat,
        lon: activeRegion.lon,
        startDate: submitted.start,
        endDate: submitted.end,
      }),
    enabled: tab !== 'sband' && tab !== 'collections',
    staleTime: 300000,
    gcTime: 900000,
    retry: 0,
  })

  const collectionsQuery = useQuery({
    queryKey: ['discover-nisar-collections'],
    queryFn: discoverNisarCollections,
    enabled: tab === 'collections',
    staleTime: 300000,
    gcTime: 900000,
    retry: 0,
  })

  const levelOf = (sn: string) =>
    sn.includes('SME2') ? 'L3' : sn.includes('GCOV') || sn.includes('GUNW') || sn.includes('GSLC') ? 'L2' : sn.includes('R') ? 'L1' : '—'
  const rows = query.data ?? []

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Data Catalog</h1>
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'all', label: 'All L2 GCOV Granules' },
          { id: 'insar', label: 'InSAR (L2 GUNW)' },
          { id: 'collections', label: 'All NASA CMR Collections' },
          { id: 'sband', label: 'S-band (ISRO)' },
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

      {tab === 'sband' ? (
        <Card title="S-band (ISRO Bhoonidhi)">
          <p>
            NISAR S-band data is served by ISRO through the Bhoonidhi portal — this catalog queries NASA
            Earthdata CMR L-band archives, so no S-band placeholder rows are fabricated.
          </p>
        </Card>
      ) : tab === 'collections' ? (
        <div className="space-y-3">
          {collectionsQuery.isLoading && <Skeleton className="h-40" />}
          {(collectionsQuery.data?.length ?? 0) === 0 && !collectionsQuery.isLoading && (
            <Card title="No collections loaded">
              <p>Verify Earthdata authentication in Settings to discover live CMR collections.</p>
            </Card>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            {(collectionsQuery.data ?? []).map((c) => (
              <Card key={c.short_name} title={`${c.short_name} (v${c.version || '?'})`}>
                <p className="text-xs text-cyan-300">{c.family}</p>
                <p className="text-xs text-white/75">{c.title}</p>
                {c.abstract && <p className="text-xs text-white/45">{c.abstract}</p>}
              </Card>
            ))}
          </div>
        </div>
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
              className="text-sm bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-1.5 font-medium text-white disabled:opacity-50"
            >
              {query.isFetching ? 'Searching live catalog…' : 'Search'}
            </button>
          </div>
          {query.isError && <p className="text-red-300 text-sm">{query.error.message}</p>}
          {query.isLoading && <Skeleton className="h-32" />}
          {!query.isError && !query.isLoading && rows.length === 0 && (
            <Card title="No products">
              <p>
                No live {tab === 'insar' ? 'GUNW InSAR' : 'GCOV'} granules match — widen dates or pick another
                region.
              </p>
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
