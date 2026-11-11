import { Card } from '../components/Card'

export default function Methodology() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Scientific Methodology &amp; Limitations</h1>
        <p className="text-white/60 text-sm mt-1">
          Transparent documentation of how TerraPulse processes NASA-ISRO NISAR L2 GCOV data and what
          a single backscatter difference cannot tell you.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="1. Data Source & Windowed Streaming">
          <p>
            TerraPulse queries NASA Common Metadata Repository (CMR) via{' '}
            <code className="text-cyan-300">earthaccess</code> for real{' '}
            <strong className="text-white">NISAR L2 GCOV</strong> (Geocoded Polarimetric Covariance) HDF5
            granules.
          </p>
          <p>
            Coordinates <code className="text-cyan-300">(lat, lon)</code> are reprojected from WGS84 into
            each granule&apos;s native projected UTM/polar EPSG CRS via{' '}
            <code className="text-cyan-300">pyproj</code>, slicing only the local spatial window around
            the target point instead of downloading full multi-gigabyte swaths.
          </p>
        </Card>

        <Card title="2. Log-Ratio Backscatter Difference (dB)">
          <p>
            Raw GCOV layers store linear power <code className="text-cyan-300">σ⁰</code>. TerraPulse
            converts before and after windows to decibels first:
          </p>
          <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-cyan-200 overflow-x-auto">
{`sigma0_db = 10 * log10(max(sigma0_linear, 1e-9))
delta_db  = sigma0_after_db - sigma0_before_db`}
          </pre>
          <p className="text-xs text-white/60">
            Negative ΔdB means darker return after the event (typical of smooth specular open water);
            large positive or negative ΔdB flags strong surface roughness alteration.
          </p>
        </Card>

        <Card title="3. Hazard Detection Modes">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong className="text-white">Flood / Tsunami (decrease mode):</strong> flags pixels with{' '}
              <code className="text-cyan-300">ΔdB &lt; −2.0 dB</code> where standing water reduces
              backscatter.
            </li>
            <li>
              <strong className="text-white">Volcano / Earthquake (magnitude mode):</strong> flags
              pixels with <code className="text-cyan-300">|ΔdB| &gt; 2.0 dB</code> from fresh lava,
              tephra, landslides, or ground disruption.
            </li>
            <li>
              <strong className="text-white">Hurricane (both mode):</strong> inspects both flooding
              drops and wind-damaged canopy/debris increases.
            </li>
          </ul>
        </Card>

        <Card title="4. Georeferenced Polygons & Area Calculation">
          <p>
            Small isolated speckle components (&lt;4 pixels) are dropped using connected-component
            filtering (<code className="text-cyan-300">scipy.ndimage.label</code>). Remaining masks are
            polygonized with an <code className="text-cyan-300">Affine</code> transform built from the
            granule&apos;s true meter grid and reprojected to WGS84 GeoJSON polygons.
          </p>
          <p className="text-xs text-white/60">
            Area equals <code className="text-cyan-300">pixel_count × |dx| × |dy| / 1e6</code> km² and
            is reported as unavailable when grid spacing metadata is absent.
          </p>
        </Card>
      </div>

      <Card title="5. Scientific Honesty: What TerraPulse CANNOT Conclude">
        <ul className="list-disc pl-5 space-y-1 text-white/75">
          <li>
            Every output is an <strong className="text-white">indicator only</strong>, never a validated
            hazard map or official damage assessment.
          </li>
          <li>
            Agricultural harvests, soil moisture, seasonal leaf-out, wind roughening on water, and radar
            layover/shadowing all change backscatter independently of disasters.
          </li>
          <li>
            Backscatter amplitude cannot measure coseismic ground displacement or fault slip — true
            deformation requires interferometric phase (InSAR / GUNW products).
          </li>
          <li>
            Cross-orbit pairs (Ascending vs. Descending) introduce look-angle differences and are
            rejected or flagged by compatibility checks.
          </li>
        </ul>
      </Card>
    </div>
  )
}
