import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './Card'
import { SevBadge } from './SevBadge'

describe('UI primitives', () => {
  it('renders Card title, action slot, and body children', () => {
    render(
      <Card title="Recent Analyses" action={<button type="button">Refresh</button>}>
        <p>Indicator content</p>
      </Card>,
    )
    expect(screen.getByText('Recent Analyses')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByText('Indicator content')).toBeInTheDocument()
  })

  it('renders severity levels cleanly', () => {
    render(
      <div>
        <SevBadge level="High" />
        <SevBadge level="Medium" />
        <SevBadge level="Low" />
      </div>,
    )
    expect(screen.getByText('High')).toHaveClass('text-red-300')
    expect(screen.getByText('Medium')).toHaveClass('text-amber-300')
    expect(screen.getByText('Low')).toHaveClass('text-sky-300')
  })
})
