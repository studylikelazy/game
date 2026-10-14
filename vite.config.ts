import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // Project Pages is served under /game/; Cloudflare is served from the root.
  base: mode === 'pages' ? '/game/' : '/',
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
}));
