export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/__clerk/, '');
  const target = `https://frontend-api.clerk.dev${path}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set('Clerk-Proxy-Url', `https://${url.host}/__clerk`);
  headers.set('Clerk-Secret-Key', process.env.CLERK_SECRET_KEY!);
  headers.set('X-Forwarded-For', req.headers.get('x-forwarded-for') || '');

  const resp = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    redirect: 'manual',
  });

  return new Response(resp.body, { status: resp.status, headers: resp.headers });
}
