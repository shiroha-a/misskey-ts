<!--
SPDX-FileCopyrightText: mk-go project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<!--
		**確認できなかったことを隠さない (#2961)。** 0 件として描くと、実際には
		申請があるユーザーを「履歴なし」と判断する。審査画面が nameConflict /
		remoteGone で採っているのと同じ判断。
	-->
	<!--
		**集計にも再試行を置く (レビュー M1)。** 失敗すると期間別の使用状況ごと
		消えるうえ、`fetchSummary` の呼び出しは onMounted の 1 箇所しか無いので、
		復旧手段がページのリロードだけになる (#2960 が mk.20c で直したのと同じ形)。
		文面が「もう一度読み込んでください」と指示しているのに、その操作が UI に
		無い状態でもあった。
	-->
	<div v-if="summaryFailed" class="_gaps_s">
		<MkInfo warn>{{ i18n.ts._emojiApplication.summaryUnknown }}</MkInfo>
		<MkButton :disabled="summaryFetching" @click="fetchSummary">{{ i18n.ts.retry }}</MkButton>
	</div>
	<FormSection v-else-if="counts" :first="true">
		<template #label>{{ i18n.ts._emojiApplication.userSummaryTitle }}</template>
		<div :class="$style.counts">
			<div v-for="c in countCards" :key="c.key" :class="$style.count">
				<div :class="$style.countValue">{{ c.value }}</div>
				<div :class="$style.countLabel">{{ c.label }}</div>
			</div>
		</div>
	</FormSection>

	<FormSection v-if="!summaryFailed && windows.length > 0">
		<template #label>{{ i18n.ts._emojiApplication.quotaTitle }}</template>
		<div class="_gaps_s">
			<MkKeyValue v-for="w in windows" :key="w.period" oneline>
				<template #key>{{ quotaPeriodLabel(w.period) }}</template>
				<template #value>
					<span :class="quotaIsFull(w) ? $style.full : undefined">{{ quotaUsageLabel(w) }}</span>
				</template>
			</MkKeyValue>
			<!--
				**上限に達しているときだけ次に出せる日時を出す。** 空きがあるのに
				出すと「今は出せない」と読める。時刻が無い場合 (審査待ちの上限も
				同時に満杯) は時刻を騙らない。
			-->
			<template v-for="w in windows" :key="`full-${w.period}`">
				<MkInfo v-if="quotaIsFull(w)" warn>
					{{ w.retryAt ? i18n.tsx._emojiApplication.quotaFullUntil({ retryAt: formatDateTime(w.retryAt) }) : i18n.ts._emojiApplication.quotaUnknownRetry }}
				</MkInfo>
			</template>
		</div>
	</FormSection>

	<FormSection>
		<template #label>{{ i18n.ts._emojiApplication.userHistoryTitle }}</template>
		<div class="_gaps_s">
			<div :class="$style.filters">
				<MkSelect v-model="status" :items="statusDef" :class="$style.filter" @update:modelValue="reload"/>
				<MkInput v-model="query" :class="$style.filter" type="search" :debounce="true" @update:modelValue="reload">
					<template #prefix><i class="ti ti-search"></i></template>
					<template #label>{{ i18n.ts._emojiApplication.searchPlaceholder }}</template>
				</MkInput>
			</div>

			<MkInfo v-if="historyFailed && items.length === 0" warn>{{ i18n.ts._emojiApplication.historyUnknown }}</MkInfo>
			<MkLoading v-else-if="fetching && items.length === 0"/>
			<div v-else-if="items.length === 0" :class="$style.empty">{{ i18n.ts._emojiApplication.noApplications }}</div>

			<div v-for="item in items" :key="item.id" :class="$style.row">
				<div :class="$style.thumb">
					<img v-if="previewUrls.get(item.id)" :src="previewUrls.get(item.id)!" :alt="item.name" :class="$style.thumbImg" @error="onPreviewError(item)"/>
					<span v-else :class="$style.thumbGone">{{ imageMissingLabel(item) }}</span>
				</div>
				<div :class="$style.body">
					<div :class="$style.head">
						<i :class="item.remoteHost ? 'ti ti-world-download' : 'ti ti-mood-smile'"></i>
						<span class="_monospace">:{{ item.name }}:</span>
						<span :class="[$style.status, $style[item.status]]">{{ relatedStatusLabel(item.status) }}</span>
					</div>
					<MkKeyValue v-if="item.remoteHost" oneline>
						<template #key>{{ i18n.ts._emojiApplication.remoteSource }}</template>
						<template #value><span class="_monospace">:{{ item.remoteName }}:@{{ item.remoteHost }}</span></template>
					</MkKeyValue>
					<MkKeyValue oneline>
						<template #key>{{ i18n.ts._emojiApplication.appliedAt }}</template>
						<template #value><MkTime :time="item.createdAt" mode="detail"/></template>
					</MkKeyValue>
					<MkKeyValue v-if="item.processedAt" oneline>
						<template #key>{{ i18n.ts._emojiApplication.processedAt }}</template>
						<template #value><MkTime :time="item.processedAt" mode="detail"/></template>
					</MkKeyValue>
					<MkKeyValue v-if="item.emojiId" oneline>
						<template #key>{{ i18n.ts._emojiApplication.emojiId }}</template>
						<template #value><span class="_monospace">{{ item.emojiId }}</span></template>
					</MkKeyValue>
					<!-- **却下理由が本体。** これが無いと「却下された」しか分からない。 -->
					<MkInfo v-if="item.rejectReason" warn>{{ item.rejectReason }}</MkInfo>
				</div>
			</div>

			<!--
				**追加読み込みに失敗しても、読めていた履歴は消さない。** 確認できて
				いたものまで隠すと、判断材料が減る方向に倒れる。
			-->
			<MkInfo v-if="historyFailed && items.length > 0" warn>{{ i18n.ts._emojiApplication.historyUnknown }}</MkInfo>
			<MkButton v-if="canLoadMore || historyFailed" :disabled="fetching" @click="loadMore">
				{{ historyFailed ? i18n.ts.retry : i18n.ts.loadMore }}
			</MkButton>
		</div>
	</FormSection>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import MkTime from '@/components/global/MkTime.vue';
import FormSection from '@/components/form/section.vue';
import { useMkSelect } from '@/composables/use-mkselect.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { dateTimeFormat } from '@/utility/intl-const.js';
import { relatedImageMissingReason, relatedPreviewUrl, relatedStatusLabel } from '@/utility/emoji-application-related.js';
import { canLoadMoreUserApplications, quotaIsFull, quotaPeriodLabel, quotaUsageLabel, userApplicationNextCursor } from '@/utility/emoji-application-user.js';
import type { QuotaWindowView } from '@/utility/emoji-application-user.js';

type Item = {
	id: string;
	status: 'pending' | 'approved' | 'rejected' | 'canceled';
	name: string;
	createdAt: string;
	processedAt: string | null;
	rejectReason?: string;
	emojiId?: string;
	url: string | null;
	remoteHost?: string;
	remoteName?: string;
};

type Counts = {
	total: number;
	pending: number;
	approved: number;
	rejected: number;
	canceled: number;
};

const props = defineProps<{ userId: string }>();

const PAGE = 30;

const counts = ref<Counts | null>(null);
const windows = ref<QuotaWindowView[]>([]);
const items = ref<Item[]>([]);
const { model: status, def: statusDef } = useMkSelect({
	items: [
		{ label: i18n.ts._emojiApplication.filterAll, value: 'all' },
		{ label: i18n.ts._emojiApplication.statusPending, value: 'pending' },
		{ label: i18n.ts._emojiApplication.statusApproved, value: 'approved' },
		{ label: i18n.ts._emojiApplication.statusRejected, value: 'rejected' },
		{ label: i18n.ts._emojiApplication.statusCanceled, value: 'canceled' },
	],
	initialValue: 'all',
});
const query = ref('');
const fetching = ref(false);
const summaryFailed = ref(false);
const summaryFetching = ref(false);
const historyFailed = ref(false);
const lastPageSize = ref(0);
const brokenPreviews = ref(new Set<string>());

const canLoadMore = computed(() => canLoadMoreUserApplications(lastPageSize.value, PAGE));

const countCards = computed(() => {
	const c = counts.value;
	if (c == null) return [];
	return [
		{ key: 'total', label: i18n.ts.total, value: c.total },
		{ key: 'pending', label: i18n.ts._emojiApplication.statusPending, value: c.pending },
		{ key: 'approved', label: i18n.ts._emojiApplication.statusApproved, value: c.approved },
		{ key: 'rejected', label: i18n.ts._emojiApplication.statusRejected, value: c.rejected },
		{ key: 'canceled', label: i18n.ts._emojiApplication.statusCanceled, value: c.canceled },
	];
});

// **1 行につき 1 回だけ解決する。** template から関数を呼ぶと再描画のたびに
// 走り、`<img>` の src が同値でも別インスタンスになる (審査画面と同じ理由)。
const previewUrls = computed(() => {
	const map = new Map<string, string | null>();
	for (const item of items.value) {
		map.set(item.id, relatedPreviewUrl(item, brokenPreviews.value));
	}
	return map;
});

// **この画面の文面にする (レビュー L1)。** 審査画面の `imageUnknown` は
// 「承認する前にもう一度読み込んでください」まで言うが、ここには承認操作が
// 無く、行の大半は処理済み。判定は共有したまま文面だけ分ける。
function imageMissingLabel(item: Item): string {
	return relatedImageMissingReason(item, brokenPreviews.value) === 'gone'
		? i18n.ts._emojiApplication.imageGone
		: i18n.ts._emojiApplication.imageUnknownShort;
}

function onPreviewError(item: Item) {
	brokenPreviews.value = new Set(brokenPreviews.value).add(item.id);
}

function formatDateTime(at: string): string {
	return dateTimeFormat.format(new Date(at));
}

async function fetchSummary() {
	if (summaryFetching.value) return;
	summaryFetching.value = true;
	try {
		const res = await misskeyApi('admin/emoji-application/user-summary' as never, {
			userId: props.userId,
		} as never) as unknown as { counts: Counts; windows: QuotaWindowView[] };
		counts.value = res.counts;
		windows.value = res.windows;
		summaryFailed.value = false;
	} catch {
		// **握り潰さない。** 0 件として描くと「申請なし」と読める。
		summaryFailed.value = true;
	} finally {
		summaryFetching.value = false;
	}
}

// **世代で古い応答を捨てる (レビュー H1)。** `if (fetching) return` で新しい
// 要求を捨てる形だと、取得中に絞り込みや検索を変えたときに**要求が 1 本も出ない
// まま、あとから解決した旧フィルタの結果が並ぶ**。「却下」と表示された一覧に
// 承認済みが混ざり、エラーもスピナーも出ないので気付けない (実測)。しかも次の
// 「もっと見る」は別の結果集合から採ったカーソルを渡すので、以降の行が永久に
// 出てこない。捨てるのは要求ではなく**古い応答**のほうにする。
let generation = 0;

async function fetchPage(untilId?: string) {
	const gen = ++generation;
	fetching.value = true;
	try {
		const res = await misskeyApi('admin/emoji-application/list-by-user' as never, {
			userId: props.userId,
			status: status.value,
			query: query.value,
			limit: PAGE,
			untilId: untilId ?? null,
		} as never) as unknown as { items: Item[] };
		if (gen !== generation) return;
		items.value = untilId == null ? res.items : [...items.value, ...res.items];
		lastPageSize.value = res.items.length;
		historyFailed.value = false;
	} catch {
		if (gen !== generation) return;
		historyFailed.value = true;
	} finally {
		// **最新の要求だけが解除する。** 古い応答が解除すると、実際には
		// まだ飛んでいるのにボタンが押せる状態になる。
		if (gen === generation) fetching.value = false;
	}
}

function reload() {
	// 絞り込みを変えたら 1 ページ目から取り直す。**古い行を残さない** —
	// 残すと「却下だけ」を選んでいるのに承認済みが並ぶ。
	items.value = [];
	lastPageSize.value = 0;
	void fetchPage();
}

function loadMore() {
	// 失敗しているときは最初から取り直す (untilId を渡すと 1 ページ目が
	// 永久に埋まらない)。
	void fetchPage(userApplicationNextCursor(items.value));
}

onMounted(() => {
	void fetchSummary();
	void fetchPage();
});
</script>

<style lang="scss" module>
.counts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
	gap: 8px;
}

.count {
	padding: 10px;
	text-align: center;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: var(--MI-radius-sm);
}

.countValue {
	font-size: 1.2em;
	font-weight: bold;
}

.countLabel {
	font-size: 0.85em;
	opacity: 0.7;
}

.full {
	color: var(--MI_THEME-warn);
	font-weight: bold;
}

.filters {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.filter {
	flex: 1 1 180px;
	margin: 0;
}

.empty {
	padding: 16px;
	text-align: center;
	opacity: 0.7;
}

.row {
	display: grid;
	grid-template-columns: 64px 1fr;
	gap: 12px;
	align-items: start;
	padding: 10px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: var(--MI-radius-sm);
}

.thumb {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 64px;
}

.thumbImg {
	max-width: 64px;
	max-height: 64px;
	object-fit: contain;
}

.thumbGone {
	font-size: 0.75em;
	opacity: 0.7;
	text-align: center;
}

.body {
	display: flex;
	flex-direction: column;
	gap: 6px;
	min-width: 0;
}

.head {
	display: flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
}

.status {
	font-size: 0.8em;
	padding: 2px 6px;
	border-radius: var(--MI-radius-xs);
	background: var(--MI_THEME-buttonBg);
}

.pending {
	background: var(--MI_THEME-infoBg);
}

.approved {
	background: var(--MI_THEME-success);
	color: #fff;
}

.rejected {
	background: var(--MI_THEME-error);
	color: #fff;
}

.canceled {
	opacity: 0.7;
}
</style>
