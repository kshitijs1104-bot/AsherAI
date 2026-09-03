import type { IncomingMessage, ServerResponse } from 'http'; export default function handler(req: IncomingMessage, res: ServerResponse) { res.statusCode = 200; res.end('ok'); }
