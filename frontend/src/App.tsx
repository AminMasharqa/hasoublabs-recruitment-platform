/**
 * The application root component.
 *
 * Deliberately thin: everything — the provider stack, the chrome, the router and
 * the runtime they are built on — lives in `shell/AppShell.tsx`. This file exists
 * because `main.tsx` mounts one component, and keeping that component separate
 * from the mount lets a test render the whole application without touching the
 * DOM entry point.
 */

import { AppShell } from './shell/AppShell'

export default function App() {
  return <AppShell />
}
