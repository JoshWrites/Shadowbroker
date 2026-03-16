// All API calls use relative paths (e.g. /api/flights).
// The catch-all route handler at src/app/api/[...path]/route.ts proxies them
// to BACKEND_URL at runtime (set in docker-compose or .env.local for dev).
// This means:
//   - No build-time baking of the backend URL into the client bundle
//   - BACKEND_URL=http://backend:8000 works via Docker internal networking
//   - Only port 3000 needs to be exposed externally
export const API_BASE = "";

// Direct backend URL for local-data endpoints (SQLite reads, no external calls).
// Bypasses the Next.js proxy so these calls are never subject to rate limiting.
// The backend port 8000 must be exposed on the host (it is in docker-compose).
export const BACKEND_DIRECT = "http://localhost:8000";
