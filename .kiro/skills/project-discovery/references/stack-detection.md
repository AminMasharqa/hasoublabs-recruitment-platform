# Stack Detection Reference

Prefer manifest evidence over filename guessing.

| Evidence | Likely stack | Confirm with |
|---|---|---|
| `vite.config.*` | Vite | package scripts and `src/main.*` |
| `next.config.*` | Next.js | `app/` or `pages/` |
| `astro.config.*` | Astro | `src/pages/` |
| `svelte.config.*` | Svelte/SvelteKit | dependencies and routes |
| `vue` dependency | Vue | `src/main.*`, `.vue` files |
| `react` dependency | React | `src/main.*`, JSX/TSX |
| only `index.html` | Static site | linked CSS and JS |

Never assume `npm`; inspect lockfiles for npm, pnpm, yarn, or Bun.
