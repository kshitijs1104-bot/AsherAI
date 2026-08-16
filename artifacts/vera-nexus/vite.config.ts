import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT and BASE_PATH are only actually consumed below by the dev/preview
// server settings (server.port, preview.port, base) — a production `vite
// build` never reads them. Previously these were required unconditionally,
// which meant `vite build` (e.g. run directly in CI, or via a plain
// `pnpm run build` outside Replit's own dev environment where PORT/BASE_PATH
// get injected automatically) failed immediately even though the build
// itself doesn't need either value. `process.argv` includes the vite
// subcommand ("build", "dev", "preview"), so this checks specifically
// whether we're in a mode that actually needs a live server port.
const isServeMode = process.argv.includes("dev") || process.argv.includes("preview") || process.argv.includes("serve");

const rawPort = process.env.PORT;

if (isServeMode && !rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = rawPort ? Number(rawPort) : 5173;

if (isServeMode && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (isServeMode && !basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// ---- Security headers for the HTML app ----
//
// THE GAP THIS CLOSES. The api-server has helmet (see its app.ts) so the JSON
// API is covered. The FRONTEND had nothing: `vite preview` is what serves the
// built app in this deployment (package.json's `serve` script), and it sends
// no security headers of its own. So the actual product surface — the pages a
// founder logs into, holding their company data — shipped with no HSTS, no
// clickjacking protection and no referrer policy, while the API behind it had
// all three.
//
// WHY THESE AND NOT A FULL CSP. Everything below is a header that cannot break
// a working page: they constrain framing, sniffing, referrers and permissions,
// none of which this app relies on. A document `script-src`/`connect-src` CSP
// is the one genuinely worth adding next and is deliberately NOT guessed at
// here, because this app loads Clerk's SDK and Google Fonts from third-party
// origins and a CSP written blind would either silently allow everything
// (pointless) or break sign-in in production only (worse than none). Write it
// against the real deployed origin list, test the auth flow, then add it — see
// `frame-ancestors` below, which is the part of CSP that is safe to state now.
//
// If this app ever moves behind a CDN or a different host, these must be
// reproduced there: they are properties of the RESPONSE, so whatever serves
// the HTML owns them.
const SECURITY_HEADERS: Record<string, string> = {
  // Item: HSTS. Tells the browser to refuse plain http:// for this host for a
  // year, which is what stops a downgraded first request from ever carrying a
  // session cookie in clear. Not preloaded — `preload` is a one-way door that
  // needs the apex domain and every subdomain ready for https, so it is a
  // deliberate decision to make once the domain is final, not a default.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",

  // Clickjacking. `frame-ancestors 'none'` is the modern control and
  // X-Frame-Options is the fallback for anything that predates it. This app
  // has destructive one-click controls behind auth — "Delete account" in
  // GeneralSettings among them — which is exactly the shape of thing a
  // transparent overlay in a hostile iframe is built to steal a click on.
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",

  // Stops a response being reinterpreted as a type it didn't declare.
  "X-Content-Type-Options": "nosniff",

  // Full URLs here can carry chat and dossier identifiers. Send the origin
  // only when leaving this site, and nothing at all on a downgrade to http.
  "Referrer-Policy": "strict-origin-when-cross-origin",

  // Nothing in Vera uses the camera, microphone or location. Saying so denies
  // them to any embedded content too, rather than leaving it to a future
  // dependency to ask.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export default defineConfig({
  base: basePath ?? "/",
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // Same headers in dev, so a header that breaks something is found while
    // developing rather than on the deployed site. HSTS is harmless on
    // localhost (browsers ignore it for http://localhost).
    headers: SECURITY_HEADERS,
    // Dev-only: the raw (non-generated-client) fetch calls throughout this
    // app (GoalPanel, Venus.tsx, venusApi.ts) all hit relative `/api/...`
    // paths on the assumption that the frontend and api-server are served
    // same-origin — true in production (see the api-server's CORS
    // credentials:false + cookie-based Clerk session), but not true for two
    // independent `vite dev` / `pnpm dev` processes on different ports. This
    // proxies `/api` to the local api-server dev port so that assumption
    // actually holds during local development too.
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.API_PORT ?? 8080}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    // This is the production path — `pnpm run serve` is what serves the built
    // app. See SECURITY_HEADERS above.
    headers: SECURITY_HEADERS,
  },
});