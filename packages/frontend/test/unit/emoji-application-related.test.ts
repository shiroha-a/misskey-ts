/*
 * SPDX-FileCopyrightText: mk-go project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect, vi } from 'vitest';

vi.mock('@/i18n.js', () => ({
	i18n: {
		ts: {
			_emojiApplication: {
				matchedByName: 'NAME',
				matchedByRemoteSource: 'SOURCE',
				matchedByFileHash: 'IMAGE',
			},
		},
	},
}));
vi.mock('@/utility/media-proxy.js', () => ({
	getProxiedImageUrl: (url: string, ...rest: unknown[]) => `proxy(${url},${rest.join(',')})`,
}));

import { canLoadMoreRelated, matchedByLabel, relatedPreviewUrl } from '@/utility/emoji-application-related.js';

const counts = (total: number) => ({ total, pending: 0, approved: 0, rejected: 0, canceled: 0 });

/**
 * mk-go: 審査画面の関連する過去申請 (#2960)。
 */
describe('matchedByLabel', () => {
	test('既知の条件はラベルにする', () => {
		expect(matchedByLabel('name')).toBe('NAME');
		expect(matchedByLabel('remoteSource')).toBe('SOURCE');
		expect(matchedByLabel('fileHash')).toBe('IMAGE');
	});

	// **未知の条件でラベルを捏造しない。** サーバー側に条件が増えたとき、
	// 既存のラベルを当てると「名前が同じ」と出ているのに実際は別の理由、
	// という誤った案内になる。
	test('未知の条件は生のまま出す', () => {
		expect(matchedByLabel('aliases')).toBe('aliases');
		expect(matchedByLabel('')).toBe('');
	});
});

describe('canLoadMoreRelated', () => {
	// **総数と取得済みの差で判断する。** 「返ってきた件数が limit と同じ」で
	// 判定すると、総数がちょうど割り切れたときに空の追加読み込みが出る。
	test('残りがあるときだけ true', () => {
		expect(canLoadMoreRelated(counts(10), 5)).toBe(true);
		expect(canLoadMoreRelated(counts(5), 5)).toBe(false);
		expect(canLoadMoreRelated(counts(0), 0)).toBe(false);
	});

	test('取得前は false', () => {
		expect(canLoadMoreRelated(null, 0)).toBe(false);
	});

	// 総数より多く取れている状態 (履歴が減った) でも追加読み込みを出さない。
	test('取得済みが総数を超えていても false', () => {
		expect(canLoadMoreRelated(counts(3), 5)).toBe(false);
	});
});

describe('relatedPreviewUrl', () => {
	const none = new Set<string>();

	test('自作画像はそのまま出す', () => {
		expect(relatedPreviewUrl({ id: 'a', url: 'https://self/x.png' }, none)).toBe('https://self/x.png');
	});

	// **リモートは media proxy を通す。** 生 URL は `img-src 'self'` を
	// enforce している構成で黙ってブロックされる (#2957 と同じ)。
	test('リモート絵文字は proxy を通す', () => {
		const got = relatedPreviewUrl({ id: 'a', url: 'https://remote/x.png', remoteHost: 'remote' }, none);
		expect(got).toContain('proxy(https://remote/x.png');
		expect(got).not.toBe('https://remote/x.png');
	});

	// null = 確認できなかった / 空文字 = 申請者が drive から消した。
	test.each([
		['null', null],
		['空文字', ''],
	])('%s は出さない', (_label, url) => {
		expect(relatedPreviewUrl({ id: 'a', url }, none)).toBeNull();
	});

	test('読み込みに失敗したものは出さない', () => {
		expect(relatedPreviewUrl({ id: 'a', url: 'https://self/x.png' }, new Set(['a']))).toBeNull();
	});
});
