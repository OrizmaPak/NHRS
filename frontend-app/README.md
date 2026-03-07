# NHRS Frontend App

Production-grade frontend foundation for NHRS built with React + TypeScript + Vite + Tailwind.

## Stack

- React 19 + TypeScript
- Vite
- TailwindCSS
- React Router
- Zustand (client state)
- TanStack Query (server state)
- TanStack Table (data grids)
- React Hook Form + Zod
- Radix UI primitives + cmdk
- Sonner toasts

## Run

```bash
cd frontend-app
npm install
npm run dev
```

## Environment

```env
VITE_API_BASE_URL=http://localhost:8080
VITE_CONTEXT_SWITCH_FALLBACK=false
VITE_ENABLE_QUERY_DEVTOOLS=false
```

- `VITE_CONTEXT_SWITCH_FALLBACK=false` keeps context switching strict against backend contract.
- Set to `true` only for local compatibility when `/me/context/switch` is not yet available.
- `VITE_ENABLE_QUERY_DEVTOOLS=false` hides TanStack Query Devtools drawer/button.
- Set to `true` in development only when debugging query cache/network behavior.

## Architecture

```text
src/
  app/
    App.tsx
    providers/
  api/
  assets/
  components/
    data/
    feedback/
    forms/
    layout/
    navigation/
    overlays/
    theme/
    ui/
  hooks/
  layouts/
  modules/
  routes/
  stores/
  styles/
  types/
```

## UX Foundation Included

- Context-aware shell (`AppShell`, `Topbar`, `Sidebar`)
- Runtime context switching with brand/theme updates
- Permission-aware route and UI gating
- Reusable enterprise `DataTable`
- Async searchable `SmartSelect`
- Modal, drawer, confirm dialog systems
- Skeleton/loading/error/empty states
- Accessibility defaults (contrast, readable font, reduced motion, font scaling)
- Appearance and brand settings scaffolds with logo uploader UI

## Backend Integration Notes

Backend already exists under root `services/`. This app is intentionally isolated in `frontend-app/`.

### Recommended integration steps

1. Set `VITE_API_BASE_URL` to API gateway URL.
2. Login uses `POST /auth/login` and expects `{ accessToken, refreshToken }`.
3. Identity boot uses `GET /me` with fallback to `GET /auth/me`.
4. Context switching uses `POST /me/context/switch`.
5. Theme loading uses `GET /ui/theme/effective`.

## Session Security Model (current)

- Access token: in-memory only (not persisted to localStorage).
- Refresh token: sessionStorage (cleared when browser session ends).

For stronger production posture, move refresh/session handling to secure HttpOnly cookies via backend.
