import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { PAINEL_SENHA: 'senha-de-teste', TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: { setupFiles: ['./test/setup.ts'] },
});
