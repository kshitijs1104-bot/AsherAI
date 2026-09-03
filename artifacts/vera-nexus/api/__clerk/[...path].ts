import type { IncomingMessage, ServerResponse } from 'http';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url || '').replace(/^\/__clerk/, '');
  const target = `https://frontend-api.clerk.dev${path}`;

  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const headers: Record<string, string> = {
    'Clerk-Proxy-Url': `https://${req.headers.host}/__clerk`,
    'Clerk-Secret-Key': process.env.CLERK_SECRET_KEY as string,
    'X-Forwarded-For': (req.headers['x-forwarded-for'] as string) || '',
  };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'] as string;

  const resp = await fetch(target, {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
    redirect: 'manual',
  });

  const text = await resp.text();
  res.statusCode = resp.status;
  resp.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-encoding') res.setHeader(key, value);
  });
  res.end(text);
}
