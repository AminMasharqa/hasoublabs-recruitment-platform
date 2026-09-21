/**
 * The DOM entry point.
 *
 * Style import order is load-bearing: Mantine's own stylesheet first, then the
 * application's baseline, so an application rule always wins over the library
 * default it overrides (Requirement 1 AC2).
 *
 * i18next initialization is *not* here — `shell/AppShell.tsx` performs it at module
 * scope, so importing the shell is enough and no provider can render against an
 * uninitialized instance regardless of which entry point mounted it.
 */

import '@mantine/core/styles.css'
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'

const container = document.getElementById('root')

if (container === null) {
  throw new Error('Mount point #root is missing from the document')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
