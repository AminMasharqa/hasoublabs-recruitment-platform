import { useDirection } from '@mantine/core'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { BidiText, DirectionProvider } from './DirectionProvider'
import { createI18n, setActiveLocale } from './index'
import {
  applyDocumentDirection,
  documentDirectionAttributes,
  useActiveDirection,
  useActiveLocale,
} from './localeDirection'

/** Reports the direction Mantine components read. */
function MantineDirectionProbe() {
  const { dir } = useDirection()
  return <span data-testid="mantine-dir">{dir}</span>
}

afterEach(() => {
  document.documentElement.removeAttribute('dir')
  document.documentElement.removeAttribute('lang')
})

describe('documentDirectionAttributes (Requirement 19 AC6, AC7)', () => {
  it('derives rtl for ar and he and ltr for en', () => {
    expect(documentDirectionAttributes('ar')).toEqual({ dir: 'rtl', lang: 'ar' })
    expect(documentDirectionAttributes('he')).toEqual({ dir: 'rtl', lang: 'he' })
    expect(documentDirectionAttributes('en')).toEqual({ dir: 'ltr', lang: 'en' })
  })
})

describe('applyDocumentDirection', () => {
  it('writes dir and lang onto the given root', () => {
    const root = document.createElement('html')
    expect(applyDocumentDirection('he', root)).toEqual({ dir: 'rtl', lang: 'he' })
    expect(root.getAttribute('dir')).toBe('rtl')
    expect(root.getAttribute('lang')).toBe('he')
  })

  it('is a no-op without a root', () => {
    expect(() => applyDocumentDirection('ar', null)).not.toThrow()
  })
})

describe('DirectionProvider (Requirement 19 AC6, AC7)', () => {
  it('sets the document root to rtl for an rtl Locale', () => {
    const instance = createI18n('ar')
    render(
      <DirectionProvider instance={instance}>
        <MantineDirectionProbe />
      </DirectionProvider>,
    )
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    expect(screen.getByTestId('mantine-dir')).toHaveTextContent('rtl')
  })

  it('sets the document root to ltr for en', () => {
    const instance = createI18n('en')
    render(
      <DirectionProvider instance={instance}>
        <MantineDirectionProbe />
      </DirectionProvider>,
    )
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    expect(screen.getByTestId('mantine-dir')).toHaveTextContent('ltr')
  })

  it('follows a locale change in place, without a reload (AC5)', async () => {
    const instance = createI18n('en')
    render(
      <DirectionProvider instance={instance}>
        <MantineDirectionProbe />
      </DirectionProvider>,
    )
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')

    await act(async () => {
      await setActiveLocale('he', instance)
    })

    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(document.documentElement).toHaveAttribute('lang', 'he')
    expect(screen.getByTestId('mantine-dir')).toHaveTextContent('rtl')

    await act(async () => {
      await setActiveLocale('en', instance)
    })

    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    expect(screen.getByTestId('mantine-dir')).toHaveTextContent('ltr')
  })

  it('resolves a regional tag onto the direction of its language', async () => {
    const instance = createI18n('en')
    render(<DirectionProvider instance={instance} />)

    await act(async () => {
      await instance.changeLanguage('ar-SA')
    })

    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
  })
})

describe('useActiveLocale / useActiveDirection', () => {
  it('report the active Locale and its direction, and track a change', async () => {
    const instance = createI18n('he')
    function Probe() {
      return (
        <span data-testid="probe">
          {useActiveLocale(instance)}:{useActiveDirection(instance)}
        </span>
      )
    }
    render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveTextContent('he:rtl')

    await act(async () => {
      await setActiveLocale('en', instance)
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('en:ltr')
  })
})

describe('BidiText (Requirement 19 AC10)', () => {
  const arabic = '  محمد \u200fعبد الله  '

  it('renders the value byte-identically, isolated and direction-auto', () => {
    render(<BidiText value={arabic} data-testid="bidi" />)
    const rendered = screen.getByTestId('bidi')
    expect(rendered.textContent).toBe(arabic)
    expect(rendered).toHaveAttribute('dir', 'auto')
    expect(rendered.className).toContain('bidi-isolate')
  })

  it('renders an absent value as empty and keeps a caller class', () => {
    render(<BidiText value={null} className="job-title" data-testid="bidi" />)
    const rendered = screen.getByTestId('bidi')
    expect(rendered.textContent).toBe('')
    expect(rendered.className).toBe('bidi-isolate job-title')
  })
})
