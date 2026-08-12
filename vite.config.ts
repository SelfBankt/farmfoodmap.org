import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS in local dev is needed because OpenStreetMap's OAuth 2 server (Doorkeeper) rejects
// plain http:// redirect URIs outright, with no exception for localhost — see src/osmAuth.ts's
// OAuth notes. This uses a self-signed cert generated on the fly by @vitejs/plugin-basic-ssl;
// the browser will show a one-time "connection isn't private" warning per profile, which is safe
// to click through for local development (Advanced > Proceed to localhost).
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    https: true,
  },
});
