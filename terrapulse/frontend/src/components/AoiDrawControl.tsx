import { useEffect, useState } from 'react'
import { Rectangle, useMap, useMapEvents } from 'react-leaflet'

export function AoiDrawControl({
  drawing,
  drawnBbox,
  onDrawn,
}: {
  drawing: boolean
  drawnBbox: [number, number, number, number] | null
  onDrawn: (bbox: [number, number, number, number]) => void
}) {
  const map = useMap()
  const [startPt, setStartPt] = useState<{ lat: number; lng: number } | null>(null)
  const [preview, setPreview] = useState<[number, number, number, number] | null>(null)

  useEffect(() => {
    if (drawing) {
      map.dragging.disable()
      map.getContainer().style.cursor = 'crosshair'
    } else {
      map.dragging.enable()
      map.getContainer().style.cursor = ''
    }
    return () => {
      map.dragging.enable()
      map.getContainer().style.cursor = ''
    }
  }, [drawing, map])

  useMapEvents({
    mousedown(e) {
      if (!drawing) return
      setStartPt(e.latlng)
      setPreview([e.latlng.lng, e.latlng.lat, e.latlng.lng, e.latlng.lat])
    },
    mousemove(e) {
      if (!drawing || !startPt) return
      const w = Math.min(startPt.lng, e.latlng.lng)
      const s = Math.min(startPt.lat, e.latlng.lat)
      const east = Math.max(startPt.lng, e.latlng.lng)
      const n = Math.max(startPt.lat, e.latlng.lat)
      setPreview([w, s, east, n])
    },
    mouseup(e) {
      if (!drawing || !startPt) return
      const w = Math.round(Math.min(startPt.lng, e.latlng.lng) * 10000) / 10000
      const s = Math.round(Math.min(startPt.lat, e.latlng.lat) * 10000) / 10000
      const east = Math.round(Math.max(startPt.lng, e.latlng.lng) * 10000) / 10000
      const n = Math.round(Math.max(startPt.lat, e.latlng.lat) * 10000) / 10000
      setStartPt(null)
      setPreview(null)
      if (east - w > 0.002 && n - s > 0.002) {
        onDrawn([w, s, east, n])
      }
    },
  })

  const box = preview ?? drawnBbox
  if (!box) return null

  return (
    <Rectangle
      bounds={[
        [box[1], box[0]],
        [box[3], box[2]],
      ]}
      pathOptions={{
        color: '#22d3ee',
        weight: 2,
        dashArray: preview ? '4 4' : undefined,
        fillColor: '#22d3ee',
        fillOpacity: 0.12,
      }}
    />
  )
}
