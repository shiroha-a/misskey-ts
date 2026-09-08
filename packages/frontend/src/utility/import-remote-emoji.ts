/*
 * SPDX-FileCopyrightText: mk-go project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineAsyncComponent } from 'vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

/**
 * mk-go: リモート絵文字をその場からインポートする (#2698)。
 *
 * 投稿本文中の絵文字とリアクションの**両方**から呼ぶので、ここに集約する。
 * CherryPick は本文からはモーダルを出し、リアクションからは endpoint を直接
 * 叩いていて挙動が揃っていない。そこは踏襲しない。
 *
 * **ここでは id と画像 URL の解決だけを行う。** 右クリックから呼ぶとき、
 * frontend が持っているのは `name@host` だけで emoji の id を知らない。既存の
 * 管理画面からの呼び出しは emoji オブジェクトを持っているので、モーダルの props は
 * そちらに揃えてある。メタデータの取得はモーダル側が `emojiId` で行う。
 *
 * `nameWithHost` は `foo@example.com` 形式 (前後のコロンは含まない)。ローカル
 * 絵文字は呼び出し側で除外すること。
 */
type RemoteEmojiMeta = {
	fetched: boolean;
	reason?: 'unsupported' | 'notFound' | 'error';
	emojiId: string;
	name: string;
	host: string;
	originalUrl: string;
	category?: string;
	aliases?: string[];
	license?: string;
	isSensitive?: boolean;
};

// mk-go 独自のエンドポイントなので misskey-js の型集合には無い。
// signup-applications.vue と同じ理由の cast。
function api<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
	return misskeyApi(endpoint as never, params as never) as unknown as Promise<T>;
}

export async function importRemoteEmoji(nameWithHost: string): Promise<void> {
	const at = nameWithHost.lastIndexOf('@');
	if (at <= 0) return;
	const name = nameWithHost.slice(0, at);
	const host = nameWithHost.slice(at + 1);
	if (name === '' || host === '' || host === '.') return;

	// **取得に失敗しても id と画像 URL は返る**ので、そのままモーダルを開いて
	// 手で埋めてもらう。ここで弾くと「取り込めない絵文字」ができてしまう。
	let res: RemoteEmojiMeta;
	try {
		res = await api<RemoteEmojiMeta>('admin/emoji/fetch-remote-meta', { name, host });
	} catch {
		os.alert({ type: 'error', text: i18n.ts.somethingHappened });
		return;
	}

	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkRemoteEmojiEditDialog.vue')), {
		emoji: {
			id: res.emojiId,
			name: res.name,
			host: res.host,
			license: res.license ?? null,
			url: res.originalUrl,
		},
	}, {
		closed: () => dispose(),
	});
}
