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
			// move.ts は唯一 initTestDb(false) を呼び、TypeORM のエンティティ定義から
			// スキーマを作り直す。mk-go の migration にしか無いテーブル / カラム
			// (relay_observed_user, meta.chunkedUploadEnabled, poll.notifiedAt 等) が
			// そこで消えるため、mk-go は起動できなくなり、後続の全ファイルが道連れに
			// なる。構造上 mk-go では成立しないので除外する。
			exclude: [...(baseConfig.test?.exclude ?? []), './test/e2e/move.ts'],
			globalSetup: './test-server-mkgo/entry.ts',
			setupFiles: ['./test/setup.e2e.mkgo.ts'],
		},
	}),
);
