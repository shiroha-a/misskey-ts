/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUsers } from '@/plugin-api.js';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/i.js', () => ({ $i: null }));

beforeEach(() => { mocks.api.mockReset(); });

describe('プラグインの公開ユーザー取得', () => {
	it('空の一覧ではAPIを呼ばない', async () => {
		expect(await getUsers([])).toEqual([]);
		expect(mocks.api).not.toHaveBeenCalled();
	});

	it('重複を除き100人ずつ取得して結果をまとめる', async () => {
		mocks.api.mockImplementation(async (_endpoint: string, params: { userIds: string[] }) => params.userIds.map(id => ({ id })));
		const ids = Array.from({ length: 101 }, (_, index) => `u${index}`);
		expect(await getUsers([...ids, ids[0]])).toEqual(ids.map(id => ({ id })));
		expect(mocks.api).toHaveBeenCalledTimes(2);
		expect(mocks.api).toHaveBeenNthCalledWith(1, 'users/show', { userIds: ids.slice(0, 100) });
		expect(mocks.api).toHaveBeenNthCalledWith(2, 'users/show', { userIds: ids.slice(100) });
	});

	it('APIの失敗を呼び出し元へ伝える', async () => {
		const error = new Error('unavailable');
		mocks.api.mockRejectedValue(error);
		await expect(getUsers(['u1'])).rejects.toBe(error);
	});
});
