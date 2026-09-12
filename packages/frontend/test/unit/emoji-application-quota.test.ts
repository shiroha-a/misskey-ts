/*
 * SPDX-FileCopyrightText: mk-go project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect, vi } from 'vitest';

// **実物の i18n は読み込まない。** locale 全体と `@@/js/config.js` (meta タグを
// 読む) を引き込むので、検証したい分岐ではなく環境の都合で落ちる。
vi.mock('@/i18n.js', () => ({
	i18n: {
		ts: {
			_emojiApplication: {
				errorRateLimited: 'RATE_LIMITED',
				errorQuotaExceededUnknown: 'GENERIC',
				quotaPeriodDay: 'DAY',
				quotaPeriodWeek: 'WEEK',
				quotaPeriodMonth: 'MONTH',
			},
		},
		tsx: {
			_emojiApplication: {
				errorQuotaExceeded: (p: Record<string, unknown>) =>
					`period=${p.period} limit=${p.limit} retryAt=${p.retryAt}`,
			},
		},
	},
}));

import { emojiApplicationQuotaText } from '@/utility/emoji-application-quota.js';

const RETRY_AT = '2026-09-13T10:30:00.000Z';

function quotaError(info: unknown) {
	return { code: 'EMOJI_APPLICATION_QUOTA_EXCEEDED', info };
}

/**
 * mk-go: ロール別の期間上限 (#2958) を利用者向けの文面にする。
 *
 * **「申請しすぎです」に潰さない。** どの期間で・何件までで・いつ空くかが
 * 分からないと、待てば通るのか設定で塞がれているのかを区別できず叩き続ける。
 */
describe('emojiApplicationQuotaText', () => {
	test('期間・上限・再試行時刻をすべて文面に渡す', () => {
		const text = emojiApplicationQuotaText(quotaError({ period: 'day', limit: 3, retryAt: RETRY_AT }));
		expect(text).toContain('period=DAY');
		expect(text).toContain('limit=3');
		// 表示は閲覧者のタイムゾーンなので ISO のままではない。年だけを見る。
		expect(text).toContain('2026');
		expect(text).not.toContain(RETRY_AT);
	});

	test('期間ごとにラベルを変える', () => {
		const at = (period: string) => emojiApplicationQuotaText(quotaError({ period, limit: 1, retryAt: RETRY_AT }));
		expect(at('day')).toContain('period=DAY');
		expect(at('week')).toContain('period=WEEK');
		expect(at('month')).toContain('period=MONTH');
	});

	// **info が欠けたら汎用文へ落とす。** 「undefined 件まで」と出すくらいなら、
	// 待てば通ることだけ伝わる方がよい。サーバー側の書式が変わっても壊れない。
	test.each([
		['info ごと無い', undefined],
		['空', {}],
		['limit が数値でない', { period: 'day', limit: '3', retryAt: RETRY_AT }],
		['未知の期間', { period: 'year', limit: 3, retryAt: RETRY_AT }],
		['retryAt が日付でない', { period: 'day', limit: 3, retryAt: 'soon' }],
		['retryAt が文字列でない', { period: 'day', limit: 3, retryAt: 1757760000000 }],
		['エラーそのものが null', null],
	])('%s のときは汎用文に落とす', (_label, info) => {
		expect(emojiApplicationQuotaText(info === null ? null : quotaError(info))).toBe('GENERIC');
	});

	// **`errorRateLimited` は使わない。** 「短時間に」と書くので、月次の窓で
	// 弾かれたとき (最大 30 日待つ) に事実と食い違う。
	test('退避文面に「短時間に」の文言を使わない', () => {
		expect(emojiApplicationQuotaText(quotaError({}))).not.toBe('RATE_LIMITED');
	});
});
