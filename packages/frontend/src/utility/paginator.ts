/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, shallowRef, triggerRef } from 'vue';
import * as Misskey from 'misskey-js';
import { resolveRateLimitStop } from '@/utility/rate-limit-stop.js';
import type { ComputedRef, Ref, ShallowRef, UnwrapRef } from 'vue';
import { misskeyApi } from '@/utility/misskey-api.js';

const MAX_ITEMS = 30;
// mk-go: レート制限の再試行を連打させない間隔 (#2955)。サーバー側の窓は 60 秒
// だが、押すたびに 1 リクエスト出る形を避けるのが目的で、窓と揃える必要は無い。
const RETRY_COOLDOWN_MS = 15000;
const MAX_QUEUE_ITEMS = 100;
const FIRST_FETCH_LIMIT = 15;
const SECOND_FETCH_LIMIT = 30;

export type MisskeyEntity = {
	id: string;
	createdAt: string;
	_shouldInsertAd_?: boolean;
};

type AbsEndpointType = {
	req: unknown;
	res: unknown;
};

type FilterByEpRes<E extends Record<string, AbsEndpointType>> = {
	[K in keyof E]: E[K]['res'] extends Array<{ id: string }> ? K : never
}[keyof E];
export type PaginatorCompatibleEndpointPaths = FilterByEpRes<Misskey.Endpoints>;
export type PaginatorCompatibleEndpoints = {
	[K in PaginatorCompatibleEndpointPaths]: Misskey.Endpoints[K];
};

export type ExtractorFunction<P extends IPaginator, T> = (item: UnwrapRef<P['items']>[number]) => T;

export interface IPaginator<T = unknown, _T = T & MisskeyEntity> {
	/**
	 * 外部から直接操作しないでください
	 */
	items: Ref<_T[]> | ShallowRef<_T[]>;
	queuedAheadItemsCount: Ref<number>;
	fetching: Ref<boolean>;
	fetchingOlder: Ref<boolean>;
	fetchingNewer: Ref<boolean>;
	canFetchOlder: Ref<boolean>;
	canFetchNewer: Ref<boolean>;
	canSearch: boolean;
	error: Ref<boolean>;
	/** mk-go: 直近の取得がレート制限で拒否されたか (#2955)。 */
	rateLimited: Ref<boolean>;
	/** mk-go: レート制限で止めた向き (#2955)。 */
	rateLimitedDirection: Ref<'older' | 'newer' | null>;
	/** mk-go: 再試行を押せるか (冷却中は false、#2955)。 */
	canRetryAfterRateLimit: Ref<boolean>;
	/** mk-go: レート制限で止めた向きを再試行する (#2955)。 */
	retryAfterRateLimit(): Promise<void>;
	computedParams: ComputedRef<Misskey.Endpoints[PaginatorCompatibleEndpointPaths]['req'] | null | undefined> | null;
	initialId: MisskeyEntity['id'] | null;
	initialDate: number | null;
	initialDirection: 'newer' | 'older';
	noPaging: boolean;
	searchQuery: Ref<null | string>;
	order: Ref<'newest' | 'oldest'>;

	init(): Promise<void>;
	reload(): Promise<void>;
	fetchOlder(): Promise<void>;
	fetchNewer(options?: { toQueue?: boolean }): Promise<void>;
	trim(trigger?: boolean): void;
	unshiftItems(newItems: (_T)[]): void;
	pushItems(oldItems: (_T)[]): void;
	prepend(item: _T): void;
	enqueue(item: _T): void;
	releaseQueue(): void;
	removeItem(id: string): void;
	updateItem(id: string, updater: (item: _T) => _T): void;
}

export class Paginator<
	Endpoint extends PaginatorCompatibleEndpointPaths,
	E extends PaginatorCompatibleEndpoints[Endpoint] = PaginatorCompatibleEndpoints[Endpoint],
	T extends E['res'][number] & MisskeyEntity = E['res'][number] & MisskeyEntity,
	SRef extends boolean = false,
> implements IPaginator {
	/**
	 * 外部から直接操作しないでください
	 */
	public items: SRef extends true ? ShallowRef<T[]> : Ref<T[]>;

	public queuedAheadItemsCount = ref(0);
	public fetching = ref(true);
	public fetchingOlder = ref(false);
	public fetchingNewer = ref(false);
	public canFetchOlder = ref(false);
	public canFetchNewer = ref(false);
	public canSearch = false;
	public error = ref(false);
	/**
	 * mk-go: set when the last fetch was rejected by the rate limiter (#2955).
	 *
	 * **自動追い読みを止めるための印。** サーバー側のレート制限は「叩くのを
	 * やめる」まで解けない — store が拒否したリクエストも記録するので、429 の
	 * まま叩き続けると窓が前へ押し戻され続ける (実測で `Retry-After` が 58 秒
	 * 前後に張り付いたまま解けなかった)。無限スクロールが握り潰して再試行を
	 * 続けると、**自分のバケットを自分で開かないまま固定し続ける**。
	 *
	 * `error` は使わない。あちらは一覧をエラー表示で置き換えるので、既に
	 * 読めている分が消える。
	 */
	public rateLimited = ref(false);
	/**
	 * mk-go: which direction was stopped by the rate limiter (#2955).
	 *
	 * **再試行は止めた向きだけを戻す。** 無条件に `canFetchOlder` を立てると、
	 * 上方向で止まったときに戻る先が違い、終端に達して false になっていた
	 * 一覧にも「もっと見る」が復活する。
	 */
	public rateLimitedDirection = ref<'older' | 'newer' | null>(null);
	/**
	 * mk-go: guards the retry button against being mashed (#2955).
	 *
	 * **コンポーネントに持たせない。** notice は親の v-if の枝なので、再試行で
	 * `fetching` が立つと枝が移って**アンマウントされ、冷却が消える**。429 で
	 * 戻ると新しいインスタンスが冷却なしで生える (実測)。しかもそれは
	 * 「自走が止まった直後に人が押すもの」= init 経路そのもの。
	 */
	public canRetryAfterRateLimit = ref(true);
	private retryCooldownTimer: number | null = null;
	private endpoint: Endpoint;
	private limit: number;
	private params: E['req'] | (() => E['req']);
	public computedParams: ComputedRef<E['req'] | null | undefined> | null;
	public initialId: MisskeyEntity['id'] | null = null;
	public initialDate: number | null = null;

	// 初回読み込み時、initialIdを基準にそれより新しいものを取得するか古いものを取得するか
	// newer: initialIdより新しいものを取得する
	// older: initialIdより古いものを取得する (default)
	public initialDirection: 'newer' | 'older';

	private offsetMode: boolean;
	public noPaging: boolean;
	public searchQuery = ref<null | string>('');
	private searchParamName: keyof E['req'] | 'search';
	private canFetchDetection: 'safe' | 'limit' | null = null;
	private aheadQueue: T[] = [];
	private useShallowRef: SRef;

	// 配列内の要素をどのような順序で並べるか
	// newest: 新しいものが先頭 (default)
	// oldest: 古いものが先頭
	// NOTE: このようなプロパティを用意してこっち側で並びを管理せずに、Setで持っておき参照者側が好きに並び変えるような設計の方がすっきりしそうなものの、Vueのレンダリングのたびに並び替え処理が発生することになったりしそうでパフォーマンス上の懸念がある
	public order: Ref<'newest' | 'oldest'>;

	constructor(endpoint: Endpoint, props: {
		limit?: number;
		params?: E['req'] | (() => E['req']);
		computedParams?: ComputedRef<E['req'] | null | undefined>;

		/**
		 * 検索APIのような、ページング不可なエンドポイントを利用する場合
		 * (そのようなAPIをこの関数で使うのは若干矛盾してるけど)
		 */
		noPaging?: boolean;

		offsetMode?: boolean;

		initialId?: MisskeyEntity['id'];
		initialDate?: number | null;
		initialDirection?: 'newer' | 'older';

		order?: 'newest' | 'oldest';

		// 一部のAPIはさらに遡れる場合でもパフォーマンス上の理由でlimit以下の結果を返す場合があり、その場合はsafe、それ以外はlimitにすることを推奨
		canFetchDetection?: 'safe' | 'limit';

		useShallowRef?: SRef;

		canSearch?: boolean;
		searchParamName?: keyof E['req'];
	}) {
		this.endpoint = endpoint;
		this.useShallowRef = (props.useShallowRef ?? false) as SRef;
		if (this.useShallowRef) {
			this.items = shallowRef<T[]>([]);
		} else {
			this.items = ref<T[]>([]) as Ref<T[]>;
		}

		this.limit = props.limit ?? FIRST_FETCH_LIMIT;
		this.params = props.params ?? {};
		this.computedParams = props.computedParams ?? null;
		this.order = ref(props.order ?? 'newest');
		this.initialId = props.initialId ?? null;
		this.initialDate = props.initialDate ?? null;
		this.initialDirection = props.initialDirection ?? 'older';
		this.canFetchDetection = props.canFetchDetection ?? null;
		this.noPaging = props.noPaging ?? false;
		this.offsetMode = props.offsetMode ?? false;
		this.canSearch = props.canSearch ?? false;
		this.searchParamName = props.searchParamName ?? 'search';

		this.getNewestId = this.getNewestId.bind(this);
		this.getOldestId = this.getOldestId.bind(this);
		this.init = this.init.bind(this);
		this.reload = this.reload.bind(this);
		this.fetchOlder = this.fetchOlder.bind(this);
		this.fetchNewer = this.fetchNewer.bind(this);
		this.unshiftItems = this.unshiftItems.bind(this);
		this.pushItems = this.pushItems.bind(this);
		this.prepend = this.prepend.bind(this);
		this.enqueue = this.enqueue.bind(this);
		this.releaseQueue = this.releaseQueue.bind(this);
		this.removeItem = this.removeItem.bind(this);
		this.updateItem = this.updateItem.bind(this);
	}

	private getNewestId(): string | null | undefined {
		// 様々な要因により並び順は保証されないのでソートが必要
		if (this.aheadQueue.length > 0) {
			return this.aheadQueue.map(x => x.id).sort().at(-1);
		}
		return this.items.value.map(x => x.id).sort().at(-1);
	}

	private getOldestId(): string | null | undefined {
		// 様々な要因により並び順は保証されないのでソートが必要
		return this.items.value.map(x => x.id).sort().at(0);
	}

	public async init(): Promise<void> {
		this.items.value = [];
		this.aheadQueue = [];
		this.queuedAheadItemsCount.value = 0;
		this.fetching.value = true;

		const data: E['req'] = {
			...(typeof this.params === 'function' ? this.params() : this.params),
			...(this.computedParams ? this.computedParams.value : {}),
			...(this.searchQuery.value != null && this.searchQuery.value.trim() !== '' ? { [this.searchParamName]: this.searchQuery.value } : {}),
			limit: this.limit ?? FIRST_FETCH_LIMIT,
			allowPartial: true,
			...((this.initialId == null && this.initialDate == null) && this.initialDirection === 'newer' ? {
				sinceId: '0',
			} : this.initialDirection === 'newer' ? {
				sinceId: this.initialId ?? undefined,
				sinceDate: this.initialDate ?? undefined,
			} : (this.initialId || this.initialDate) && this.initialDirection === 'older' ? {
				untilId: this.initialId ?? undefined,
				untilDate: this.initialDate ?? undefined,
			} : {}),
		};

		const apiRes = (await misskeyApi(this.endpoint, data).catch(err => {
			// **初回の取得でも 429 を区別する (レビュー M-2)。** ここを汎用の
			// error に潰すと `MkError` が「何かがおかしいようです」を描く。
			// 自動追い読みが止まった直後に利用者が最初にやるのは再読み込み
			// なので、**同じ窓の中でこの経路に入る確率が高い**。しかも
			// `MkError` の再試行は `init()` をもう一度撃ち、窓をさらに押し戻す。
			// **先に落としてから付け直す (レビュー 3 周目 H-1)。** 古い 429 の印が
			// 残っているとネットワーク断の失敗でも「レート制限」と誤表示する。
			// 枝の条件が `error` を見るようになったので、ここを落とさないと
			// 嘘の診断になる。**後から判定する形では駄目** — `noteRateLimit` は
			// 429 でなければ何もしないので、残った印を見て「まだ制限中」と
			// 判断してしまう (実測でテストが落ちた)。
			this.clearRateLimit();
			this.noteRateLimit(err, this.initialDirection);
			this.error.value = true;
			this.fetching.value = false;
			return null;
		})) as T[] | null;

		if (apiRes == null) {
			return;
		}

		// 逆順で返ってくるので
		if ((this.initialId || this.initialDate) && this.initialDirection === 'newer') {
			apiRes.reverse();
		}

		for (let i = 0; i < apiRes.length; i++) {
			const item = apiRes[i];
			if (i === 3) item._shouldInsertAd_ = true;
		}

		this.pushItems(apiRes);

		if (this.canFetchDetection === 'limit') {
			if (apiRes.length < FIRST_FETCH_LIMIT) {
				(this.initialDirection === 'older' ? this.canFetchOlder : this.canFetchNewer).value = false;
			} else {
				(this.initialDirection === 'older' ? this.canFetchOlder : this.canFetchNewer).value = true;
			}
		} else if (this.canFetchDetection === 'safe' || this.canFetchDetection == null) {
			if (apiRes.length === 0 || this.noPaging) {
				(this.initialDirection === 'older' ? this.canFetchOlder : this.canFetchNewer).value = false;
			} else {
				(this.initialDirection === 'older' ? this.canFetchOlder : this.canFetchNewer).value = true;
			}
		}

		this.error.value = false;
		this.clearRateLimit();
		this.fetching.value = false;
	}

	public reload(): Promise<void> {
		return this.init();
	}

	/**
	 * mk-go: records whether a fetch was rejected by the rate limiter (#2955).
	 *
	 * **429 だけを他のエラーと区別する。** ネットワーク断などは従来どおり黙って
	 * 握り潰す (一時的なもので、再試行すれば直るため)。レート制限は逆で、
	 * **再試行が状況を悪化させる**唯一のケースなので止める必要がある。
	 */
	private noteRateLimit(err: unknown, direction: 'older' | 'newer'): void {
		const decision = resolveRateLimitStop(err, direction);
		if (!decision.rateLimited) return;
		this.rateLimited.value = true;
		this.rateLimitedDirection.value = decision.stop;
		// **追い読みの自動発火を止める。** MkPagination は `canFetch*` が true の
		// 間ボタンを描き、`v-appear` が視界に入るたび再発火する。値を残したまま
		// UI 側で止めると、ボタンの再マウントでまた撃たれるので、ここで落とす。
		if (decision.stop === 'older') {
			this.canFetchOlder.value = false;
		} else if (decision.stop === 'newer') {
			this.canFetchNewer.value = false;
		}
	}

	/**
	 * mk-go: clears the rate-limit state after a successful fetch (#2955).
	 *
	 * **成功したら必ず戻す。** 戻さないと、再読み込みや検索で正常に読めるように
	 * なっても「レート制限を超えました」が残り、**制限中でもないのに制限中と
	 * 表示する**。`error` が `init` の成功時に戻されているのと同じ扱い。
	 */
	// **取得の成功では解除しない (レビュー 2 周目 M-1)。** 一度そうしていたが、
	// **別方向の in-flight が成功すると、こちらの 429 で立てた印だけが消える**。
	// 結果 `rateLimited=false` + `canFetchOlder=false` で「これで全部」に見え、
	// 次の `trim()` が理由表示の無いまま自走を戻す。印を立てた向きは
	// `canFetch*` を false にしてあるので、同じ向きの再取得は
	// `retryAfterRateLimit()` か `init()` しか通らず、どちらも先に解除する。
	// **取得の成功では解除しない。** 429 の後は `fetchOlder` / `fetchNewer` の
	// どちらもガードで止まるので、成功する取得は `retryAfterRateLimit()` か
	// `init()` からしか来ず、どちらも**先に**解除する。成功時にも解除する形は
	// 一度入れたが、**429 の前から in-flight だった別方向の取得が後から成功
	// すると印だけ消える** (notice も「もっと見る」も無い =「これで全部」に
	// 見える) ので戻した。**解除の経路は再試行と再読み込みだけ**にしてある。
	private clearRateLimit(): void {
		this.rateLimited.value = false;
		this.rateLimitedDirection.value = null;
	}

	/**
	 * mk-go: retries the direction that the rate limiter stopped (#2955).
	 *
	 * **止めた向きだけを戻して、その向きを撃つ。** 無条件に `canFetchOlder` を
	 * 立てると、上方向で止まったときに戻る先が違い、終端に達して false に
	 * なっていた一覧にも「もっと見る」が復活して無駄なリクエストを 1 本撃つ。
	 *
	 * **判断をコンポーネントに置かない。** あちらは単体テストから駆動できない
	 * ので、向きを取り違えても誰も落ちない (実測で素通りした)。
	 */
	public async retryAfterRateLimit(): Promise<void> {
		if (!this.canRetryAfterRateLimit.value) return;
		// **冷却はここで掛ける。** サーバー側は拒否も記録するので、押すほど窓が
		// 延びる。コンポーネントに持たせると枝の移動でアンマウントされて消える。
		this.canRetryAfterRateLimit.value = false;
		if (this.retryCooldownTimer != null) window.clearTimeout(this.retryCooldownTimer);
		this.retryCooldownTimer = window.setTimeout(() => {
			this.canRetryAfterRateLimit.value = true;
		}, RETRY_COOLDOWN_MS);

		const direction = this.rateLimitedDirection.value;
		if (direction === 'older') {
			this.canFetchOlder.value = true;
		} else if (direction === 'newer') {
			this.canFetchNewer.value = true;
		}
		this.clearRateLimit();
		// **初回取得が止まっていたら init から。** `fetchOlder` は
		// `items.length === 0` で早期 return するので、init() の 429 から
		// 復帰するときに `fetchOlder` を撃っても**無反応で印だけ消える**。
		if (this.items.value.length === 0) {
			await this.init();
			return;
		}
		if (direction === 'newer') {
			await this.fetchNewer({ toQueue: false });
		} else {
			await this.fetchOlder();
		}
	}

	public async fetchOlder(): Promise<void> {
		// **向きを問わず止める (レビュー 3 周目 M-3)。** newer が 429 になっても
		// `canFetchOlder` は無傷なので、`v-appear` が視界に入ると 1 発撃つ。
		// 完了条件「429 を受けたら自動で再試行されない」を満たすため、
		// `fetchNewer` と同じガードを置く。
		if (this.rateLimited.value) return;
		if (!this.canFetchOlder.value || this.fetching.value || this.fetchingOlder.value || this.items.value.length === 0) return;
		this.fetchingOlder.value = true;

		const data: E['req'] = {
			...(typeof this.params === 'function' ? this.params() : this.params),
			...(this.computedParams ? this.computedParams.value : {}),
			...(this.searchQuery.value != null && this.searchQuery.value.trim() !== '' ? { [this.searchParamName]: this.searchQuery.value } : {}),
			limit: SECOND_FETCH_LIMIT,
			...(this.offsetMode ? {
				offset: this.items.value.length,
			} : {
				untilId: this.getOldestId(),
			}),
		};

		const apiRes = (await misskeyApi<T[]>(this.endpoint, data).catch(err => {
			this.noteRateLimit(err, 'older');
			return null;
		})) as T[] | null;

		this.fetchingOlder.value = false;

		if (apiRes == null) {
			return;
		}

		for (let i = 0; i < apiRes.length; i++) {
			const item = apiRes[i];
			if (i === 10) item._shouldInsertAd_ = true;
		}

		if (this.order.value === 'oldest') {
			this.unshiftItems(apiRes.toReversed(), false);
		} else {
			this.pushItems(apiRes);
		}

		if (this.canFetchDetection === 'limit') {
			if (apiRes.length < FIRST_FETCH_LIMIT) {
				this.canFetchOlder.value = false;
			} else {
				this.canFetchOlder.value = true;
			}
		} else if (this.canFetchDetection === 'safe' || this.canFetchDetection == null) {
			if (apiRes.length === 0) {
				this.canFetchOlder.value = false;
			} else {
				this.canFetchOlder.value = true;
			}
		}
	}

	// **レート制限中は撃たない (レビュー M-7)。** `fetchNewer` には
	// `fetchOlder` のような `canFetch*` のガードが無く、streaming 系は
	// `useInterval` で 10〜22 秒ごとに無条件で撃つ。止めたつもりの 'newer' 側が
	// 実際には止まらない。
	public async fetchNewer(options: {
		toQueue?: boolean;
	} = {}): Promise<void> {
		if (this.rateLimited.value) return;
		this.fetchingNewer.value = true;

		const data: E['req'] = {
			...(typeof this.params === 'function' ? this.params() : this.params),
			...(this.computedParams ? this.computedParams.value : {}),
			...(this.searchQuery.value != null && this.searchQuery.value.trim() !== '' ? { [this.searchParamName]: this.searchQuery.value } : {}),
			limit: SECOND_FETCH_LIMIT,
			...(this.offsetMode ? {
				offset: this.items.value.length,
			} : {
				sinceId: this.getNewestId(),
			}),
		};

		const apiRes = (await misskeyApi<T[]>(this.endpoint, data).catch(err => {
			this.noteRateLimit(err, 'newer');
			return null;
		})) as T[] | null;

		this.fetchingNewer.value = false;

		if (apiRes == null || apiRes.length === 0) {
			this.canFetchNewer.value = false;
			// 余計なre-renderを防止するためここで終了
			return;
		}

		if (options.toQueue) {
			this.aheadQueue.unshift(...apiRes.toReversed());
			if (this.aheadQueue.length > MAX_QUEUE_ITEMS) {
				this.aheadQueue = this.aheadQueue.slice(0, MAX_QUEUE_ITEMS);
			}
			this.queuedAheadItemsCount.value = this.aheadQueue.length;
		} else {
			if (this.order.value === 'oldest') {
				this.pushItems(apiRes);
			} else {
				this.unshiftItems(apiRes.toReversed(), false);
			}
		}

		if (this.canFetchDetection === 'limit') {
			if (apiRes.length < FIRST_FETCH_LIMIT) {
				this.canFetchNewer.value = false;
			} else {
				this.canFetchNewer.value = true;
			}
		}
		// canFetchDetectionが'safe'の場合・apiRes.length === 0 の場合は apiRes.length === 0 の場合に canFetchNewer.value = false になるが、
		// 余計な re-render を防ぐために上部で処理している。そのため、ここでは何もしない
	}

	public trim(trigger = true): void {
		// **レート制限で止めているあいだは復活させない (レビュー H-2)。**
		// streaming 系は届いたアイテムを `prepend` / `releaseQueue` で入れる
		// たびにここを通るので、**通知が 1 件届くだけで停止が解除される**。
		// 解除されると `v-show` が display:none から戻り、`IntersectionObserver`
		// が交差の変化として callback を出して `v-appear` が再発火する。
		if (this.items.value.length >= MAX_ITEMS && !this.rateLimited.value) this.canFetchOlder.value = true;
		this.items.value = this.items.value.slice(0, MAX_ITEMS);
		if (this.useShallowRef && trigger) triggerRef(this.items);
	}

	public unshiftItems(newItems: T[], trim = true): void {
		if (newItems.length === 0) return; // これやらないと余計なre-renderが走る
		this.items.value.unshift(...newItems.filter(x => !this.items.value.some(y => y.id === x.id))); // ストリーミングやポーリングのタイミングによっては重複することがあるため
		if (trim) this.trim(true);
		if (this.useShallowRef) triggerRef(this.items);
	}

	public pushItems(oldItems: T[]): void {
		if (oldItems.length === 0) return; // これやらないと余計なre-renderが走る
		this.items.value.push(...oldItems);
		if (this.useShallowRef) triggerRef(this.items);
	}

	public prepend(item: T): void {
		if (this.items.value.some(x => x.id === item.id)) return;
		this.items.value.unshift(item);
		this.trim(false);
		if (this.useShallowRef) triggerRef(this.items);
	}

	public enqueue(item: T): void {
		this.aheadQueue.unshift(item);
		if (this.aheadQueue.length > MAX_QUEUE_ITEMS) {
			this.aheadQueue.pop();
		}
		this.queuedAheadItemsCount.value = this.aheadQueue.length;
	}

	public releaseQueue(): void {
		if (this.aheadQueue.length === 0) return; // これやらないと余計なre-renderが走る
		this.unshiftItems(this.aheadQueue);
		this.aheadQueue = [];
		this.queuedAheadItemsCount.value = 0;
	}

	public removeItem(id: string): void {
		// TODO: queueからも消す

		const index = this.items.value.findIndex(x => x.id === id);
		if (index !== -1) {
			this.items.value.splice(index, 1);
			if (this.useShallowRef) triggerRef(this.items);
		}
	}

	public updateItem(id: string, updater: (item: T) => T): void {
		// TODO: queueのも更新

		const index = this.items.value.findIndex(x => x.id === id);
		if (index !== -1) {
			const item = this.items.value[index]!;
			this.items.value[index] = updater(item);
			if (this.useShallowRef) triggerRef(this.items);
		}
	}
}
