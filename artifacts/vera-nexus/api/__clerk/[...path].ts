import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = req.url?.replace(/^\/__clerk/, '') || '';
  const target = `https://frontend-api.clerk.dev${path}`;

  const headers: Record<string, string> = {
    'Clerk-Proxy-Url': `https://${req.headers.host}/__clerk`,
    'Clerk-Secret-Key': process.env.CLERK_SECRET_KEY as string,
    'X-Forwarded-For': (req.headers['x-forwarded-for'] as string) || '',
    'Content-Type': (req.headers['content-type'] as string) || 'application/json',
  };

  const resp = await fetch(target, {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    redirect: 'manual',
  });

  const text = await resp.text();
  res.status(resp.status);
  resp.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-encoding') res.setHeader(key, value);
  });
  res.send(text);
}
