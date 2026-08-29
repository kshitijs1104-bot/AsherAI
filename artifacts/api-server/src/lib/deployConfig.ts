export function originOfUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

function replitPublicUrl(): string | null {
  const candidates = [
    process.env.REPLIT_HOSTNAME,
    process.env.REPLIT_PUBLIC_DOMAIN,
    process.env.REPLIT_APP_NAME && process.env.REPLIT_OWNER
      ? `${process.env.REPLIT_APP_NAME}--${process.env.REPLIT_OWNER}.replit.app`
      : null,
    process.env.REPLIT_APP_NAME && process.env.REPLIT_OWNER
      ? `${process.env.REPLIT_APP_NAME}--${process.env.REPLIT_OWNER}.replit.app`
      : null,
  ].filter((candidate): candidate is string => !!candidate?.trim());

  if (candidates.length === 0) return null;

  const normalized = candidates[0].trim();
  return normalized.includes('://') ? normalized.replace(/\/$/, '') : `https://${normalized.replace(/\/$/, '')}`;
}

export function resolveFrontendUrl(): string {
  const configured = process.env.FRONTEND_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  const replit = replitPublicUrl();
  if (replit) return replit;

  return '';
}

export function resolveAllowedOrigins(): string[] {
  const configured = (process.env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const frontend = resolveFrontendUrl();
  const frontendOrigin = originOfUrl(frontend);
  const derived = replitPublicUrl() ? [replitPublicUrl()!].filter(Boolean) : [];

  return Array.from(new Set([...configured, ...(frontendOrigin ? [frontendOrigin] : []), ...derived]));
}

export function resolveClerkPublishableKey(): string {
  const explicit = process.env.CLERK_PUBLISHABLE_KEY?.trim();
  if (explicit) return explicit;

  const viteKey = process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (viteKey) {
    process.env.CLERK_PUBLISHABLE_KEY = viteKey;
    return viteKey;
  }

  return '';
}
