/*
 * SPDX-FileCopyrightText: mk-go project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';
import { dateTimeFormat } from '@/utility/intl-const.js';

type QuotaInfo = {
	period?: unknown;
	limit?: unknown;
	retryAt?: unknown;
};

/**
 * Renders the rolling-window rejection returned by `emoji-application/create`
 * (#2958), or null when the error is something else.
 *
 * **どの期間で・何件までで・いつ空くかを出す。** 「申請しすぎです」だけだと、
 * 待てば通るのか設定で塞がれているのかが分からず、利用者は叩き続ける。
 */
export function emojiApplicationQuotaText(err: unknown): string | null {
	const e = err as { code?: string; info?: QuotaInfo } | null;
	if (e?.code !== 'EMOJI_APPLICATION_QUOTA_EXCEEDED') return null;

	const info = e.info ?? {};
	const limit = typeof info.limit === 'number' ? info.limit : null;
	const period = quotaPeriodLabel(info.period);
	const retryAt = quotaRetryAtLabel(info.retryAt);
	// **info が欠けていたら汎用文に落とす。** 「undefined件まで」と出すより、
	// 待てば通ることだけ伝わる方がよい。
	if (limit == null || period == null || retryAt == null) {
		return i18n.ts._emojiApplication.errorRateLimited;
	}
	return i18n.tsx._emojiApplication.errorQuotaExceeded({ period, limit, retryAt });
}

function quotaPeriodLabel(period: unknown): string | null {
	switch (period) {
		case 'day': return i18n.ts._emojiApplication.quotaPeriodDay;
		case 'week': return i18n.ts._emojiApplication.quotaPeriodWeek;
		case 'month': return i18n.ts._emojiApplication.quotaPeriodMonth;
		// 期間の種類が増えたときに嘘のラベルを出さない。
		default: return null;
	}
}

function quotaRetryAtLabel(retryAt: unknown): string | null {
	if (typeof retryAt !== 'string') return null;
	const at = new Date(retryAt);
	if (Number.isNaN(at.getTime())) return null;
	return dateTimeFormat.format(at);
}
