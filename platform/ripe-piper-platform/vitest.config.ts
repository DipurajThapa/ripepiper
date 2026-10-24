import { defineConfig } from 'vitest/config';
// Bound concurrent PostgreSQL/WASM fixtures to avoid memory contention and spurious timeouts.
export default defineConfig({ test: { setupFiles: ['./test/network-guard.ts'], api: false, maxWorkers: 4 } });
