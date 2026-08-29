import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveAllowedOrigins, resolveClerkPublishableKey, resolveFrontendUrl, originOfUrl } = await import('./deployConfig.ts');

test('replit host is accepted as the frontend origin when FRONTEND_URL is unset', () => {
  const previous = {
    FRONTEND_URL: process.env.FRONTEND_URL,
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
    REPLIT_HOSTNAME: process.env.REPLIT_HOSTNAME,
    REPLIT_PUBLIC_DOMAIN: process.env.REPLIT_PUBLIC_DOMAIN,
    REPLIT_APP_NAME: process.env.REPLIT_APP_NAME,
    REPLIT_OWNER: process.env.REPLIT_OWNER,
  };

  try {
    process.env.REPLIT_HOSTNAME = 'vera-updated-new--supportaurelian.replit.app';
    delete process.env.FRONTEND_URL;
    delete process.env.ALLOWED_ORIGIN;
    delete process.env.REPLIT_PUBLIC_DOMAIN;
    delete process.env.REPLIT_APP_NAME;
    delete process.env.REPLIT_OWNER;

    assert.equal(resolveFrontendUrl(), 'https://vera-updated-new--supportaurelian.replit.app');
    assert.deepEqual(resolveAllowedOrigins(), ['https://vera-updated-new--supportaurelian.replit.app']);
    assert.equal(originOfUrl(resolveFrontendUrl()), 'https://vera-updated-new--supportaurelian.replit.app');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('server clerk publishable key falls back to the shared frontend key on Replit', () => {
  const previous = {
    CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
    VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY,
  };

  try {
    delete process.env.CLERK_PUBLISHABLE_KEY;
    process.env.VITE_CLERK_PUBLISHABLE_KEY = 'pk_test_abc';

    assert.equal(resolveClerkPublishableKey(), 'pk_test_abc');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
