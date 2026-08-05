/*
 * 本家の backend e2e を mk-go に向けて実行するための vitest 設定。
 *
 * include は本家の `test/e2e/**` をそのまま指す。差し替えるのは
 * globalSetup (サーバー起動) と setupFiles (DB リセット) の 2 点だけで、
 * テスト本体には一切手を入れない。上流追従でテストが増えれば自動的に
 * こちらの検証対象も増える。
 */

import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig } from './vitest.config.js';

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			include: ['./test/e2e/**/*.ts'],
			globalSetup: './test-server-mkgo/entry.ts',
			setupFiles: ['./test/setup.e2e.mkgo.ts'],
		},
	}),
);
