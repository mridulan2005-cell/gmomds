// Vercel serverless functions for /api/*: the same handlers the dev server and server/serve.mjs use.
// The API key is read from the project's environment variables (ANTHROPIC_API_KEY) and never reaches the tablet.
import { apiMiddleware } from '../server/api.mjs';

const handle = apiMiddleware();

export function route(path) {
  return async (req, res) => {
    req.url = path;
    // Vercel may already have read and parsed the JSON body; hand it back as a stream for the shared handler
    if (req.body !== undefined && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      const raw = JSON.stringify(req.body);
      req[Symbol.asyncIterator] = async function* () { yield raw; };
    }
    await handle(req, res, () => { res.statusCode = 404; res.end(); });
  };
}
