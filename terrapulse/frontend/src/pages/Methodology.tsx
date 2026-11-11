import { Card } from '../components/Card'
import { SEVERITY_RULE_TEXT } from '../utils/severity'

export default function Methodology() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Scientific Methodology &amp; Limitations</h1>
        <p className="text-white/60 text-sm mt-1">
          Transparent documentation of how TerraPulse processes NASA-ISRO NISAR L2 GCOV and GUNW products,
          how confidence and severity are scored, and what single-pair indicators cannot conclude.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="1. Windowed & AOI Streaming">
          <p>
            TerraPulse queries NASA Common Metadata Repository (CMR) via{' '}
            <code className="text-cyan-300">earthaccess</code> for real{' '}
            <strong className="text-white">NISAR L2 GCOV</strong> and{' '}
            <strong className="text-white">NISAR L2 GUNW</strong> HDF5 granules.
          </p>
          <p>
            Coordinates <code className="text-cyan-300">(lat, lon)</code> or drawn AOI bounding boxes are
            reprojected from WGS84 into each granule&apos;s native UTM/polar EPSG via{' '}
            <code className="text-cyan-300">pyproj</code>. Boxes larger than 512×512 native pixels are
            integer-downsampled by <code className="text-cyan-300">stride</code> with ground spacing adjusted
            accordingly.
          </p>
        </Card>

        <Card title="2. Speckle Filtering & Log-Ratio Difference">
          <p>
            SAR speckle noise is multiplicative in linear intensity <code className="text-cyan-300">σ⁰</code>.
            When enabled, Boxcar or adaptive <strong className="text-white">Lee filtering</strong> (5×5 kernel)
            operates in linear power before converting to dB:
          </p>
          <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-cyan-200 overflow-x-auto">
{`W = clip((var_local - var_noise) / (var_local * (1 + sigma_v^2)), 0, 1)
filtered = local_mean + W * (sigma0_linear - local_mean)
delta_db = 10*log10(after_filtered) - 10*log10(before_filtered)`}
          </pre>
        </Card>

        <Card title="3. Polarizations, Thresholds & InSAR">
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>
              <strong className="text-white">Flood / Tsunami (HH, decrease):</strong>{' '}
              <code className="text-cyan-300">ΔdB &lt; −2.0 dB</code> or Otsu threshold.
            </li>
            <li>
              <strong className="text-white">Forest Loss / Landslide (HV):</strong> cross-pol sensitivity to
              volume/canopy loss.
            </li>
            <li>
              <strong className="text-white">Agriculture (HH/HV ratio):</strong> surface-to-volume scattering
              shift tracking harvest, emergence, and tillage.
            </li>
            <li>
              <strong className="text-white">InSAR Deformation (GUNW):</strong> line-of-sight displacement{' '}
              <code className="text-cyan-300">Δ_los = φ · (-λ / 4π)</code> (cm) masked at{' '}
              <code className="text-cyan-300">coherence &gt;= 0.35</code>.
            </li>
          </ul>
        </Card>

        <Card title="4. Confidence Score & Area Severity">
          <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-cyan-200 overflow-x-auto">
{`score = 0.40 * effect_margin + 0.25 * log10_area_score
      + 0.20 * orbit_weight  + 0.15 * valid_frac * temporal_decay`}
          </pre>
          <p className="text-xs text-white/65">
            <strong>Severity rule:</strong> {SEVERITY_RULE_TEXT}
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
            Crop harvest, soil moisture, seasonal leaf drop, wind roughening on water, and steep-terrain
            layover all alter backscatter independently of hazards.
          </li>
          <li>
            Amplitude backscatter cannot measure coseismic displacement; use GUNW interferograms (when
            available and coherent) for LOS motion.
          </li>
        </ul>
      </Card>
    </div>
  )
}
