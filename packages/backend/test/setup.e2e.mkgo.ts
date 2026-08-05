/*
 * mk-go 版の e2e setup。
 *
 * 本家の `setup.e2e.ts` は `initTestDb(false)` で TypeORM のエンティティ定義から
 * スキーマを作り直すが、それをやると mk-go の migration でしか作られないテーブル
 * (relay_observed_user 等) が消える。代わりに mk-go の `/api/reset-db` を叩いて
 * 全テーブルを truncate する (schema_migrations は保護される)。
 */

import { beforeAll } from 'vitest';
import { loadConfig } from '@/config.js';
import { sendEnvResetRequest } from './utils.js';

const config = loadConfig();

async function resetDb(): Promise<void> {
	const res = await fetch(`http://127.0.0.1:${config.port}/api/reset-db`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
	});

	// 本家同様、失敗したら即座に落とす。半端な状態でテストを続けると原因の
	// 切り分けが困難になる。
	if (!res.ok) {
		throw new Error(`reset-db failed with status ${res.status}`);
	}
}

beforeAll(async () => {
	// 本家と同じ順序: 先にサーバーを作り直してから DB を掃除する。
	await sendEnvResetRequest();
	await resetDb();
});
