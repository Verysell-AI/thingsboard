import type { Config } from '@react-router/dev/config';

export default {
  // Single-page app: nginx serves build/client and falls back to index.html.
  ssr: false,
} satisfies Config;
