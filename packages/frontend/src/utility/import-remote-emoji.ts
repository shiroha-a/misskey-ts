/*
 * SPDX-FileCopyrightText: mk-go project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineAsyncComponent } from 'vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { customEmojisMap } from '@/custom-emojis.js';

export type RemoteEmojiMeta = {
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

/**
 * mk-go: リモート絵文字をその場からインポートする (#2698)。
 *
 * 投稿本文中の絵文字とリアクションの**両方**から呼ぶので、ここに集約する。
 * CherryPick は本文からはモーダルを出し、リアクションからは endpoint を直接
 * 叩いていて挙動が揃っていない。そこは踏襲しない。
 *
 * **`name` と `host` を別々に受ける。** `MkCustomEmoji` は
 * `name`（ホスト無しの裸の名前）と `host` を別の prop で受け取るので、
 * `name@host` の形をここで組み立てさせると呼び出し側が壊れる。
 *
 * **取得はここで 1 回だけ行い、結果をモーダルへ渡す。** モーダル側でも取ると
 * 1 回のインポートで相手へ 2 リクエスト出ることになる。
 */
/**
 * Strip the `@host` suffix from an emoji name (#2903).
 *
 * `MkCustomEmoji` は `name` に `@host` を含めないが、リアクション側の
 * `getEmojiNameFromReaction` は `name@host` を返す。両方を受けられるようにする。
 *
 * **1 箇所に集約する。** 同じ分解が 3 箇所に散らばっていたせいで、リアクション側の
 * 同名判定を「変数は作ったが条件式に配線し忘れる」形で出荷しかけた。
 */
export function bareEmojiName(name: string): string {
	return name.includes('@') ? name.slice(0, name.lastIndexOf('@')) : name;
}

/**
 * Whether a local custom emoji with the same (bare) name already exists (#2903).
 *
 * 既にあるならインポートの導線を出さない。押しても `admin/emoji/copy` が
 * 重複で弾くだけで、押してみるまで分からなかった。
 */
export function hasLocalEmojiWithSameName(name: string): boolean {
	const bare = bareEmojiName(name);
	return bare !== '' && customEmojisMap.has(bare);
}

export async function importRemoteEmoji(name: string, host: string | null | undefined): Promise<void> {
	if (name === '' || host == null || host === '' || host === '.') return;
	const bare = bareEmojiName(name);
	if (bare === '') return;

	// **取得に失敗しても id と画像 URL は返る**ので、そのままモーダルを開いて
	// 手で埋めてもらう。ここで弾くと「取り込めない絵文字」ができてしまう。
	let res: RemoteEmojiMeta;
	try {
		res = await api<RemoteEmojiMeta>('admin/emoji/fetch-remote-meta', { name: bare, host });
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
		meta: res,
	}, {
		closed: () => dispose(),
	});
}
