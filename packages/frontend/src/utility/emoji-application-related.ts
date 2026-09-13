/*
 * SPDX-FileCopyrightText: mk-go project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';
import { getProxiedImageUrl } from '@/utility/media-proxy.js';

export type RelatedCounts = {
	total: number;
	pending: number;
	approved: number;
	rejected: number;
	canceled: number;
};

export type RelatedItem = {
	id: string;
	url: string | null;
	remoteHost?: string;
};

/**
 * Renders the label for one match reason (#2960).
 *
 * **未知の条件でラベルを捏造しない。** サーバー側に条件が増えたとき、既存の
 * ラベルのどれかを当てると「名前が同じ」と出ているのに実際は別の理由、という
 * 誤った案内になる。生の値を出しておけば、少なくとも嘘にはならない。
 */
export function matchedByLabel(matchedBy: string): string {
	switch (matchedBy) {
		case 'name': return i18n.ts._emojiApplication.matchedByName;
		case 'remoteSource': return i18n.ts._emojiApplication.matchedByRemoteSource;
		case 'fileHash': return i18n.ts._emojiApplication.matchedByFileHash;
		default: return matchedBy;
	}
}

/**
 * Reports whether more related applications can be loaded (#2960).
 *
 * **総数と取得済みの差で判断する。** 「返ってきた件数が limit と同じ」で
 * 判定すると、総数がちょうど割り切れたときに**空の追加読み込み**が出る。
 */
export function canLoadMoreRelated(counts: RelatedCounts | null, loaded: number): boolean {
	if (counts == null) return false;
	return loaded < counts.total;
}

/**
 * Resolves the thumbnail for one past application (#2960).
 *
 * **リモート絵文字は media proxy を通す。** 生 URL は `img-src 'self'` を
 * enforce している構成で黙ってブロックされる (#2957 と同じ)。
 */
export function relatedPreviewUrl(item: RelatedItem, broken: ReadonlySet<string>): string | null {
	// null = 確認できなかった / 空文字 = 申請者が drive から消した。どちらも出せない。
	if (item.url == null || item.url === '') return null;
	if (broken.has(item.id)) return null;
	if (!item.remoteHost) return item.url;
	return getProxiedImageUrl(item.url, 'emoji', false, true);
}
