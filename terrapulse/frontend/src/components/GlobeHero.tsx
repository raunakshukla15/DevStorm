import { useEffect, useRef, useState } from 'react'

export interface GlobePin {
  lat: number
  lon: number
  color: string
  label: string
}

export function GlobeHero({ pins }: { pins: GlobePin[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [rotLon, setRotLon] = useState(-35)
  const dragging = useRef<{ x: number; startRot: number } | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!dragging.current) {
        setRotLon((r) => (r + 0.35) % 360)
      }
    }, 50)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    const cx = w / 2
    const cy = h / 2
    const rad = Math.min(w, h) * 0.42

    ctx.clearRect(0, 0, w, h)
    const grad = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, rad * 0.1, cx, cy, rad)
    grad.addColorStop(0, '#1e3a5f')
    grad.addColorStop(1, '#071022')
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.strokeStyle = 'rgba(56,189,248,0.4)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Graticule lines
    ctx.strokeStyle = 'rgba(148,163,184,0.16)'
    ctx.lineWidth = 1
    for (let lat = -60; lat <= 60; lat += 30) {
      const phi = (lat * Math.PI) / 180
      const rLat = rad * Math.cos(phi)
      const yLat = cy - rad * Math.sin(phi)
      ctx.beginPath()
      ctx.moveTo(cx - rLat, yLat)
      ctx.lineTo(cx + rLat, yLat)
      ctx.stroke()
    }
    const centerLam = (rotLon * Math.PI) / 180
    for (let lon = -180; lon < 180; lon += 30) {
      const lam = (lon * Math.PI) / 180 - centerLam
      ctx.beginPath()
      let started = false
      for (let lat = -85; lat <= 85; lat += 10) {
        const phi = (lat * Math.PI) / 180
        const z = Math.cos(phi) * Math.cos(lam)
        if (z < 0) {
          started = false
          continue
        }
        const px = cx + rad * Math.cos(phi) * Math.sin(lam)
        const py = cy - rad * Math.sin(phi)
        if (!started) {
          ctx.moveTo(px, py)
          started = true
        } else {
          ctx.lineTo(px, py)
        }
      }
      ctx.stroke()
    }

    // Pins
    for (const p of pins) {
      const phi = (p.lat * Math.PI) / 180
      const lam = (p.lon * Math.PI) / 180 - centerLam
      const z = Math.cos(phi) * Math.cos(lam)
      if (z < 0) continue
      const px = cx + rad * Math.cos(phi) * Math.sin(lam)
      const py = cy - rad * Math.sin(phi)
      ctx.beginPath()
      ctx.arc(px, py, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = p.color
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }, [rotLon, pins])

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        width={240}
        height={240}
        aria-label="Interactive NISAR globe overview — drag to rotate"
        className="cursor-grab active:cursor-grabbing select-none"
        onMouseDown={(e) => {
          dragging.current = { x: e.clientX, startRot: rotLon }
        }}
        onMouseMove={(e) => {
          if (!dragging.current) return
          const dx = e.clientX - dragging.current.x
          setRotLon(dragging.current.startRot + dx * 0.5)
        }}
        onMouseUp={() => {
          dragging.current = null
        }}
        onMouseLeave={() => {
          dragging.current = null
        }}
      />
      <span className="text-[11px] text-white/45">Drag globe to spin · {pins.length} tracked sites</span>
    </div>
  )
}
