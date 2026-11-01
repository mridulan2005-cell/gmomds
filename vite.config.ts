import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
// @ts-expect-error plain JS module
import { apiMiddleware } from './server/api.mjs';

function dadiApi(): Plugin {
  return {
    name: 'dadi-api',
    configureServer(server) { server.middlewares.use(apiMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use(apiMiddleware()); },
  };
}

export default defineConfig(({ mode }) => {
  // Load ANTHROPIC_API_KEY etc. from .env files into process.env for the API routes.
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'DADI_MODEL']) if (env[k] && !process.env[k]) process.env[k] = env[k];
  // The iPad camera only works on HTTPS (or localhost). Set NO_HTTPS=1 to turn it off.
  const https = !process.env.NO_HTTPS;
  return {
    plugins: [react(), dadiApi(), ...(https ? [basicSsl()] : [])],
    worker: { format: 'es' },
  };
});
