/**
 * The Locale control, rendered (Requirement 19 AC5).
 *
 * AC5 is one sentence with two halves, and both are observable:
 *
 * - *changes the active Locale* — the instance reports the selected Locale, the
 *   surrounding catalogue strings re-render, and the Direction_Provider rewrites
 *   `dir`/`lang` on the document root (AC6, AC7),
 * - *without a full page reload* — the mounted tree is asserted to be the *same*
 *   tree across the change, by carrying a piece of unrelated component state
 *   through it and comparing `location.href` on both sides. A reload or a
 *   navigation would have discarded that state; jsdom would not have performed
 *   either, which is exactly why the assertion is about the retained state rather
 *   than about a spy on a method jsdom does not implement.
 *
 * The control is also checked for presenting each Locale in its own language,
 * which is what makes it usable by someone who cannot read the current interface
 * language.
 */

import { MantineProvider } from '@mantine/core'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { beforeEach, describe, expect, it } from 'vitest'

import { createI18n } from '../i18n'
import { DirectionProvider } from '../i18n/DirectionProvider'

import { LocaleControl } from './LocaleControl'

let i18n: I18nextInstance
/** Stand-in document root, so the assertions do not depend on the jsdom document. */
let root: HTMLElement

beforeEach(() => {
  i18n = createI18n('en')
  root = document.createElement('html')
})

/**
 * A neighbour of the control that renders a catalogue string and holds a piece of
 * state of its own.
 *
 * The string proves the catalogue switched; the state proves the tree was not
 * remounted, which is the observable difference between changing the Locale in
 * place and reloading the page.
 */
function Neighbour() {
  const { t } = useTranslation(['shell'])
  const [ticks, setTicks] = useState(0)

  return (
    <button
      type="button"
      data-testid="neighbour"
      data-ticks={ticks}
      onClick={() => {
        setTicks((value) => value + 1)
      }}
    >
      {t('shell:app.name')}
    </button>
  )
}

function renderControl() {
  return render(
    <I18nextProvider i18n={i18n}>
      <DirectionProvider instance={i18n} root={root}>
        <MantineProvider>
          <LocaleControl />
          <Neighbour />
        </MantineProvider>
      </DirectionProvider>
    </I18nextProvider>,
  )
}

describe('LocaleControl', () => {
  it('presents every supported Locale named in its own language', () => {
    renderControl()

    const control = screen.getByTestId('locale-control')
    expect(control).toHaveAccessibleName('Language')
    expect([...control.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'العربية',
      'עברית',
      'English',
    ])
    expect(control).toHaveValue('en')
  })

  it('changes the active Locale, the catalogue and the direction in place (AC5, AC6)', async () => {
    const href = window.location.href

    renderControl()
    // A piece of state that only survives if the tree is never remounted.
    await userEvent.click(screen.getByTestId('neighbour'))
    expect(screen.getByTestId('neighbour')).toHaveAttribute('data-ticks', '1')

    await userEvent.selectOptions(screen.getByTestId('locale-control'), 'ar')

    await waitFor(() => {
      expect(i18n.language).toBe('ar')
    })
    // The catalogue switched…
    expect(screen.getByTestId('neighbour')).toHaveTextContent('HasoubLabs للتوظيف')
    // …the direction followed (Req 19 AC6)…
    expect(root.getAttribute('dir')).toBe('rtl')
    expect(root.getAttribute('lang')).toBe('ar')
    // …the control reflects the new Locale…
    expect(screen.getByTestId('locale-control')).toHaveValue('ar')
    // …and the tree was never remounted, at the same address as before.
    expect(screen.getByTestId('neighbour')).toHaveAttribute('data-ticks', '1')
    expect(window.location.href).toBe(href)
  })

  it('switches back to a left-to-right Locale in place (AC7)', async () => {
    i18n = createI18n('he')
    renderControl()
    expect(root.getAttribute('dir')).toBe('rtl')

    await userEvent.selectOptions(screen.getByTestId('locale-control'), 'en')

    await waitFor(() => {
      expect(root.getAttribute('dir')).toBe('ltr')
    })
    expect(root.getAttribute('lang')).toBe('en')
    expect(screen.getByTestId('neighbour')).toHaveTextContent('HasoubLabs Recruitment')
  })
})
