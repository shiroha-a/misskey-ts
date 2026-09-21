/*
 * SPDX-FileCopyrightText: mk-go project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Recovers the items that a pub/sub stream dropped while it was disconnected.
 *
 * ストリーミングで届くイベントは pub/sub なので、切断していた間に発行された分は
 * 再送されない。realtimeMode の一覧 (通知 / タイムライン) はイベントだけで中身を
 * 更新するため、再接続したら自分で差分を取りに行かないと、リロードするまで
 * 抜けたままになる。非 realtimeMode は `useInterval` の `fetchNewer` が同じ役割を
 * 果たしているので、この穴は realtimeMode にだけある。
 *
 * **起点は `_connected_` を受けた瞬間に読む。** `Stream.onOpen` はイベントを
 * emit した**後**にチャンネルを張り直すので、この時点ではまだ 1 件も届いて
 * いない = 手持ちの最新がそのまま「切断前の最新」になる。ジッターを待ってから
 * 読むと、その間に流れ込んだぶんだけ起点が進み、埋めたい穴を飛び越える。
 *
 * **`_disconnected_` は使えない。** `Stream.reconnect()` 経由の張り直し
 * (`stream.ts` がバックグラウンド 20 秒超の復帰で呼ぶ = モバイルでいちばん多い
 * 経路) は `intentionalReconnect` で抑止されるので emit されない。
 * `boot/main-boot.ts` が同じ理由でこのイベントを判定に使っていない。
 *
 * 呼び出し制御は `boot/main-boot.ts` の未読バッジ再同期と同じ理屈:
 *
 *  - **初回は抑止する。** 生成時刻で `lastAt` を埋めるので、mount 直後に
 *    `_connected_` が来ても走らない (そこは `paginator.init()` が取っている)
 *  - **間隔を空ける。** 再接続は連続しうるので、そのたびに API を叩かない
 *  - **ジッターを入れる。** 全クライアントが同時に再接続するので散らす
 *  - **多重実行しない。** 待っている間に次の再接続が来ても 1 本に畳む
 *
 * **取りに行った後の `reload()` とは競合しうる。** 投げる直前まで世代を見るので
 * 「reload が先」は避けられるが、こちらのリクエストが飛んでいる間に reload が
 * 始まると、取り直した最新ページが穴埋め分の下に入る。`:key` の重複は
 * `pushItems` 側で落とすが、並びまでは揃わない。
 *
 * **埋められるのは 1 ページぶんまで。** `fetchNewer` は 30 件までしか取らず、
 * 呼び出し側は `canFetchDetection` を設定していないので `canFetchNewer` も
 * 立たない。それを超える断では穴の古い側だけが埋まり、残りはリロードするまで
 * 出てこない。ページングして埋め切るか、埋め切れなかったことを UI に出すかは
 * 別途の判断。
 *
 * **「いま決められない」と「本当に空」は分ける。** `init()` / `reload()` の最中も
 * 一覧は空だが、そこで控えると「空だった」という起点が入れ替えを跨いで生き残る
 * (世代は `init()` の冒頭で進むので、入れ替え中に控えた値は完了後の世代と一致
 * してしまい弾けない)。前者は控えず (`undefined`)、後者は `null` を控えて
 * 呼び出し側に委ねる。**空の一覧にも穴は空く** — バッジだけ増えて中身が出ない
 * 状態になるので、埋めない判断はしない。
 *
 * **起点は接続した瞬間に控え、走るまで持ち越す。** 見送った回 (裏タブ、init /
 * reload 中、レート制限中) のあとに呼び直すとき、その場で読み直すと、見送って
 * いる間に届いたぶんだけ起点が進んで穴を飛び越える。控えを捨てるのは「実際に
 * 取りに行った」ときと「一覧が総入れ替えされた」とき (`getGeneration`) だけ。
 * 世代を見ないと、持ち越した起点が `reload()` 後に古びて、過去のページが最新の
 * 上に積まれる。
 *
 * **レート制限に当たったら通常の取得と同じ扱いになる。** `Paginator` は 429 を
 * 受けると追い読みを止めて通知を出すので、背景で撃ったぶんでもそれが起きる。
 * 背景だからと握り潰すと、実際に制限されている事実が利用者から見えなくなる
 * ほうが害が大きいので、そのままにしてある (既に制限中の回は `canResync` で
 * 見送るので、立て続けに撃つことはない)。
 */
export type ReconnectResyncOptions = {
	/**
	 * 取りこぼしの起点。`_connected_` を受けた瞬間に呼ばれる。
	 *
	 *  - 文字列: その id より新しいものを取りに行く
	 *  - `null`: 一覧が空 = 起点が無い。控えたうえで `resync(null)` を呼ぶので、
	 *    呼び出し側が「最初から取る」形に倒す
	 *  - `undefined`: いま起点を決められない (`init()` / `reload()` の最中)。
	 *    控えないので、この接続ぶんの穴はリロードするまで残る
	 */
	getNewestId: () => string | null | undefined;

	/** 起点より新しいものを取りに行く。null は「起点なし」。 */
	resync: (sinceId: string | null) => unknown;

	/**
	 * 一覧の世代。`Paginator.generation` をそのまま渡す。控えた起点は、この値が
	 * 変わった時点で無効になる (`init()` / `reload()` で中身が総入れ替えされた)。
	 */
	getGeneration?: () => number;

	/**
	 * 走ってよいかの判定。**ジッターの前後で 2 回呼ばれる** — 待っている間に
	 * 条件が変わる (タブが裏に戻る、`reload()` が始まる) ため。
	 *
	 * 前段で false を返したときは間隔を消費しない。条件が整った時点で
	 * 呼び出し側が `onConnected` を呼び直せば、待たずに走れる。
	 */
	canResync?: () => boolean;

	/** 再同期の最短間隔 (ms)。 */
	interval?: number;
	/** 実行前に待つ最大時間 (ms)。0 なら待たない。 */
	jitter?: number;
	/** テスト用の時計。 */
	now?: () => number;
	/** テスト用の乱数。 */
	random?: () => number;
	/** テスト用の待ち。 */
	sleep?: (ms: number) => Promise<void>;
};

export type ReconnectResync = {
	/** `_connected_` に渡すハンドラ。起点を控えたうえで実行を試みる。 */
	onConnected: () => Promise<void>;
	/**
	 * 控えてある起点があるときだけ実行を試みる。見送る条件 (裏タブなど) が
	 * 解けたタイミングで呼ぶ。**控えが無ければ何もしない** — 切断が無かったのに
	 * 取りに行くと、通知一覧では取得そのものが既読化を伴うので害になる。
	 */
	retry: () => Promise<void>;
	/**
	 * 以降の再同期を止める。unmount 時に呼ぶ。
	 *
	 * **既に `resync` に入ったものは止まらない。** 止められるのはまだ
	 * ジッターを待っている分まで。
	 */
	dispose: () => void;
};

const DEFAULT_INTERVAL = 30 * 1000;
const DEFAULT_JITTER = 10 * 1000;

export function createReconnectResync(options: ReconnectResyncOptions): ReconnectResync {
	const interval = options.interval ?? DEFAULT_INTERVAL;
	const jitter = options.jitter ?? DEFAULT_JITTER;
	const now = options.now ?? (() => Date.now());
	const random = options.random ?? Math.random;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); }));
	const canResync = options.canResync ?? (() => true);
	const generation = options.getGeneration ?? (() => 0);

	// 生成時刻で埋めることが初回抑止そのもの。0 にすると mount 直後の
	// `_connected_` で `paginator.init()` と二重に走る。
	let lastAt = now();
	let pending: { since: string | null; generation: number } | null = null;
	let inFlight = false;
	let disposed = false;

	const run = async (): Promise<void> => {
		if (disposed) return;
		if (inFlight) return;
		if (pending == null) return;
		if (!canResync()) return;
		if (now() - lastAt < interval) return;
		// 控えてから一覧が総入れ替えされていたら、その起点はもう意味を持たない。
		// **捨てるのは `onConnected` の仕事。** あちらが「古ければ捨てて控え直す」
		// を一手に持つので、ここで捨てると二重管理になる (捨て漏れると、以後
		// 「控えはあるが世代が合わない」で回り続けて二度と走らなくなる)。
		// **その代わり `retry()` は次の `_connected_` まで不活性になる** — 控えは
		// 残っているが世代が合わないので、ここで毎回 return する。
		if (pending.generation !== generation()) return;
		const { since, generation: gen } = pending;
		inFlight = true;
		try {
			if (jitter > 0) await sleep(random() * jitter);
			// 待っている間に unmount された / 条件が変わった / 総入れ替えされた。
			if (disposed) return;
			// **控えは消さずに戻る。** 条件が解けてから `retry()` で拾い直せる。
			if (!canResync()) return;
			// **控え直された新しい世代ではなく、自分が持ち出した `gen` と比べる。**
			// ジッターを待つ間に `onConnected` が走って控え直していることがあり、
			// `pending` を見ると「一致」してしまう (= 古い起点のまま投げる)。
			if (gen !== generation()) return;
			// **投げると決まってから控えを捨てる。** ここより前で捨てると、
			// 見送った回の穴が失われる。
			pending = null;
			// **投げる直前に更新する。** ここまでの見送りは「試行しなかった」ので
			// 間隔を消費させない (条件が解けた瞬間に呼び直せば待たされない)。
			// 失敗しても間隔は空けたいので、成功後ではなく直前に置く。
			lastAt = now();
			await options.resync(since);
		} catch {
			// `fetchNewer` は reject しないので、ここへ来るのは想定外の例外だけ。
			// unhandled rejection にしないために握る。間隔は据え置き (= 失敗しても
			// 連打しない)。
		} finally {
			inFlight = false;
		}
	};

	const onConnected = async (): Promise<void> => {
		if (disposed) return;
		// **古びた控えは先に捨てる。** 残したままだと「控えがある」と見なして
		// この接続の起点を取らず、ここで生じた穴を誰も埋めない。
		if (pending != null && pending.generation !== generation()) pending = null;
		// **起点はここで控える** (理由はファイル冒頭)。見送る回もここを通るので、
		// 条件が解けてから `retry()` で呼び直しても起点は動かない。
		if (pending == null) {
			const since = options.getNewestId();
			// **`undefined` は「いま決められない」だけを意味する** (理由は冒頭)。
			// `null` (本当に空) は控える。
			if (since !== undefined) pending = { since, generation: generation() };
		}
		await run();
	};

	return {
		onConnected,
		retry: run,
		dispose: () => {
			disposed = true;
		},
	};
}

/**
 * Builds the `createReconnectResync` options for a `Paginator`-backed list.
 *
 * **判断を `.vue` に置かない。** ここに書いてある述語 (入れ替え中かどうか、
 * 見送る条件、どこへ入れるか、どのパラメータを足すか) は過去に何度も取り違えて
 * いる箇所で、SFC の中にあるとテストから触れない。
 */
export function paginatorResyncOptions(paginator: {
	fetching: { value: boolean };
	rateLimited: { value: boolean };
	error: { value: boolean };
	generation: number;
	getNewestId: () => string | null | undefined;
	fetchNewer: (options: { toQueue?: boolean; sinceId?: string; params?: Record<string, unknown> }) => Promise<void>;
	reload: (params?: Record<string, unknown>) => Promise<void>;
}, opts: {
	/** 取得したものを queue へ積むか (= 利用者が先頭を見ていないか)。 */
	toQueue: () => boolean;
	/** この取得にだけ足すパラメータ。通知一覧は `markAsRead: false` を渡す。 */
	params?: Record<string, unknown>;
}): Pick<ReconnectResyncOptions, 'getNewestId' | 'getGeneration' | 'canResync' | 'resync'> {
	return {
		// `init()` / `reload()` の最中は「いま決められない」。一覧が空なのは
		// 一時的で、そこで控えると誤った起点が入れ替えを跨いで生き残る。
		getNewestId: () => paginator.fetching.value ? undefined : (paginator.getNewestId() ?? null),
		getGeneration: () => paginator.generation,
		// init / reload 中とレート制限中は見送る (どちらも撃つ意味が無い)。控えは
		// 残るので、次の `_connected_` か `retry()` で拾い直せる。
		// **`error` も見る。** `init()` が失敗した一覧は一度も中身を持っていない
		// ので、「切断中の穴」を定義できない。撃つと最古のページをエラー表示の
		// 裏に積むだけになる (`error` は `init()` 成功でしか降りない)。
		canResync: () => !paginator.fetching.value && !paginator.rateLimited.value && !paginator.error.value,
		// **起点が無い (一覧が空だった) ときは取り直す。** `fetchNewer` では表現
		// できない: 起点を省くとサーバーが降順で返して `toReversed()` を前提に
		// した差し込みが逆順になり、`sinceId: '0'` だと**最古のページ**を取って
		// しまう (「一覧が空なら履歴も無い」は `removeItem` で空になったときに
		// 崩れる)。空の一覧は失うものが無いので `reload()` が素直。
		resync: (sinceId) => sinceId == null
			// **`params` はこちらにも渡す。** 通知一覧の `markAsRead: false` が
			// 片方の分岐にしか効かないと、一覧が空のときだけ背景の穴埋めが
			// 全既読にする (`init()` は既定の true で撃つ)。
			? paginator.reload(opts.params)
			: paginator.fetchNewer({
				sinceId,
				toQueue: opts.toQueue(),
				...(opts.params ? { params: opts.params } : {}),
			}),
	};
}

/**
 * 通知一覧ぶんの `params`。**取得そのものが既読化を伴う** ので、背景の穴埋めでは
 * 切る (`markAsRead` 既定 true → `readAllNotifications` を publish)。あれは
 * 「利用者が一覧を開いた/更新した」ことを既読の合図とする設計で、再接続は
 * 利用者の操作ではない。そのまま撃つと、見ていない通知までバッジごと消える。
 */
export const NOTIFICATION_RESYNC_PARAMS = { markAsRead: false } as const;
