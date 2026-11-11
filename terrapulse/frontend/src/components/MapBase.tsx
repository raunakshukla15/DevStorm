import type { ReactNode, RefObject } from 'react'
import type L from 'leaflet'
import { MapContainer, TileLayer } from 'react-leaflet'

export function MapBase({
  center,
  zoom,
  baseLayer = 'esri',
  mapRef,
  children,
}: {
  center: [number, number]
  zoom: number
  baseLayer?: 'esri' | 'osm'
  mapRef?: RefObject<L.Map | null>
  children?: ReactNode
}) {
  return (
    <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} ref={mapRef}>
      {baseLayer === 'osm' ? (
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      ) : (
        <TileLayer
          attribution="Esri World Imagery"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
      )}
      {children}
    </MapContainer>
  )
}
