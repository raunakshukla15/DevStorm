import { describe, expect, it } from 'vitest'
import { fmt, formatArea, formatPower } from './format'

describe('format helpers', () => {
  it('formats finite numbers and null/NaN safely', () => {
    expect(fmt(1.23456, 2)).toBe('1.23')
    expect(fmt(null)).toBe('n/a')
    expect(fmt(Number.NaN)).toBe('n/a')
  })

  it('converts area between km2 and hectares', () => {
    expect(formatArea(1.5, 'km2')).toBe('1.500 km²')
    expect(formatArea(1.5, 'ha')).toBe('150.0 ha')
    expect(formatArea(undefined, 'ha')).toBe('n/a')
  })

  it('formats backscatter power in dB and linear units', () => {
    expect(formatPower(-3, 'db')).toBe('-3.000 dB')
    expect(formatPower(0, 'linear')).toBe('1.000×')
    expect(formatPower(null, 'linear')).toBe('n/a')
  })
})
