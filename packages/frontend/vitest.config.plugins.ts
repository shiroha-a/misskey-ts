/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config.unit.js';

const require = createRequire(import.meta.url);

// ビルド時プラグインの回帰テストは、本体の通常テストとは別に実行する。
export default defineConfig({
	...unitConfig,
	resolve: {
		...unitConfig.resolve,
		alias: {
			...unitConfig.resolve?.alias,
			'@testing-library/vue': require.resolve('@testing-library/vue'),
		},
	},
	test: {
		...unitConfig.test,
		include: ['../../../../plugins/*/frontend/*.test.ts'],
	},
});
