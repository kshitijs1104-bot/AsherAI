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
// If this app ever moves behind a CDN or a different host, these must be
// reproduced there: they are properties of the RESPONSE, so whatever serves
// the HTML owns them.

// ---- Deriving Clerk's own origin instead of guessing at it ----
//
// A full CSP was previously left out on the grounds that it would either allow
// everything or break sign-in in production only. The thing that made it a
// guess was not knowing which host Clerk loads from — and that host is not
// actually unknown: a Clerk publishable key is literally
// base64("<frontend-api-host>$"), which is how Clerk's own SDK works it out at
// runtime. Decoding it here produces an exact origin rather than a wildcard,
// and it stays correct across dev/staging/production because each environment
// carries its own key.
//
// If the key is missing or malformed the wildcard fallback is used. That is a
// deliberate weakening in exactly one case — a misconfigured build — and it is
// still narrower than the previous state of having no script-src at all.
function clerkOrigin(): string {
  const key = process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
  const encoded = key.replace(/^pk_(test|live)_/, "");
  if (!encoded) return "https://*.clerk.accounts.dev";
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const host = decoded.replace(/\$$/, "").trim();
    // A host, not a path or anything with a scheme already attached.
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : "https://*.clerk.accounts.dev";
  } catch {
    return "https://*.clerk.accounts.dev";
  }
}

// The real, complete third-party origin list, checked against the source tree
// rather than assumed:
//   - Clerk's frontend API (script + XHR), derived above.
//   - img.clerk.com for user avatars.
//   - Google Fonts: the stylesheet from fonts.googleapis.com, the faces from
//     fonts.gstatic.com. Only index.html's landing/marketing font link needs
//     these; the app itself renders on platform families.
// images.unsplash.com appears in the tree but only under src/_archive, which no
// live route reaches and which Rollup drops, so it is deliberately NOT allowed.
function contentSecurityPolicy(isDev: boolean): string {
  const clerk = clerkOrigin();

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    // No 'unsafe-inline' in production: the build emits external module
    // scripts, and Clerk injects a <script src> from its own origin, which the
    // host allowance covers. Dev needs both because Vite's HMR client and React
    // Refresh use inline scripts and eval.
    "script-src": ["'self'", clerk, ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : [])],

    // 'unsafe-inline' IS required here and is not laziness. Radix, framer-motion
    // and recharts all set element `style` attributes at runtime — that is how
    // every popover position, transform and chart dimension is applied — and
    // those are governed by style-src. The alternative is a nonce architecture
    // that none of those libraries support. Scripts, which are what actually
    // matter for injection, stay strict.
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],

    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],

    // data: and blob: are needed for locally-rendered images and object URLs
    // (attachment previews read bytes from the API and render them).
    "img-src": ["'self'", "data:", "blob:", "https://img.clerk.com"],

    // Same-origin covers /api (see the proxy below — frontend and API are one
    // origin in production). ws: is the Vite HMR socket, dev only.
    "connect-src": ["'self'", clerk, ...(isDev ? ["ws:", "wss:"] : [])],

    // Clerk uses an iframe for some verification flows.
    "frame-src": ["'self'", clerk],

    "worker-src": ["'self'", "blob:"],

    // Clickjacking. `frame-ancestors 'none'` is the modern control (X-Frame-
    // Options below is the fallback for anything that predates it). This app has
    // destructive one-click controls behind auth — "Delete account" in
    // GeneralSettings among them — which is exactly the shape of thing a
    // transparent overlay in a hostile iframe is built to steal a click on.
    "frame-ancestors": ["'none'"],

    // Nothing here embeds plugins, and nothing should be able to retarget a
    // relative URL or post this app's forms somewhere else.
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };

  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

function securityHeaders(isDev: boolean): Record<string, string> {
  return {
    // HSTS. Tells the browser to refuse plain http:// for this host for a
    // year, which is what stops a downgraded first request from ever carrying a
    // session cookie in clear. Not preloaded — `preload` is a one-way door that
    // needs the apex domain and every subdomain ready for https, so it is a
    // deliberate decision to make once the domain is final, not a default.
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",

    "Content-Security-Policy": contentSecurityPolicy(isDev),
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
}

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
    rollupOptions: {
      output: {
        // ---- Splitting one 878kB chunk into cacheable pieces ----
        //
        // Everything shipped as a single file, so a founder on a slow connection
        // waited on the charting library and the auth SDK before the landing
        // page could paint — and any change to app code invalidated the whole
        // thing, including the ~500kB of vendor code that had not changed.
        //
        // Split by CHANGE RATE, not by feature: dependencies move on their own
        // release cycles, so once cached they stay cached across every deploy of
        // Vera's own code.
        //
        // A FUNCTION, NOT THE OBJECT FORM. The object form (`{ react: ["react",
        // …] }`) matched the entry modules but Rollup hoisted the actual React
        // internals into the shared chunk anyway, emitting a literally empty
        // 0.00kB "react" file — a split that reported success and moved nothing.
        // Matching on the resolved module path catches the whole subtree
        // including transitive internals, which is what actually separates them.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;

          // React first: everything else depends on it, so it must land in its
          // own chunk before another rule can claim its files.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (id.includes("@clerk")) return "clerk";
          // framer-motion ships its runtime across three packages.
          if (/framer-motion|motion-dom|motion-utils/.test(id)) return "motion";
          // recharts pulls in the d3 family, which is the bulk of its weight.
          if (/recharts|[\\/]d3-/.test(id)) return "charts";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("lucide-react") || id.includes("react-icons")) return "icons";

          // Everything else, in one chunk rather than one per package — dozens
          // of tiny requests is its own kind of slow.
          return "vendor";
        },
      },
    },
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
    //
    // The CSP is the dev variant: Vite's HMR client and React Refresh need
    // inline scripts, eval and a websocket, none of which the production policy
    // allows. Everything else is identical, so a directive that breaks a real
    // page still breaks it here first.
    headers: securityHeaders(true),
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
    // app, so this is the CSP real users actually get. See
    // contentSecurityPolicy() above for what each directive is for and why
    // style-src is the one that has to allow inline.
    headers: securityHeaders(false),
  },
});