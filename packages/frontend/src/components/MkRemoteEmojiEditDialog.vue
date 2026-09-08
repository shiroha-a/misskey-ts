<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkWindow
	ref="windowEl"
	:initialWidth="400"
	:initialHeight="500"
	:canResize="true"
	@close="windowEl?.close()"
	@closed="emit('closed')"
>
	<template #header>:{{ name }}:</template>

	<div style="display: flex; flex-direction: column; min-height: 100%;">
		<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px; flex-grow: 1;">
			<div class="_gaps_m">
				<div v-if="imgUrl != null" :class="$style.imgs">
					<div style="background: #000;" :class="$style.imgContainer">
						<img :src="imgUrl" :class="$style.img" :alt="name"/>
					</div>
					<div style="background: #222;" :class="$style.imgContainer">
						<img :src="imgUrl" :class="$style.img" :alt="name"/>
					</div>
					<div style="background: #ddd;" :class="$style.imgContainer">
						<img :src="imgUrl" :class="$style.img" :alt="name"/>
					</div>
					<div style="background: #fff;" :class="$style.imgContainer">
						<img :src="imgUrl" :class="$style.img" :alt="name"/>
					</div>
				</div>

				<MkKeyValue>
					<template #key>{{ i18n.ts.name }}</template>
					<template #value>{{ name }}</template>
				</MkKeyValue>
				<MkKeyValue>
					<template #key>{{ i18n.ts.host }}</template>
					<template #value>{{ host }}</template>
				</MkKeyValue>

				<!--
					mk-go: 取得した値を編集できるようにした (#2698)。AP の Emoji tag は
					`name` / `icon` / `_misskey_license.freeText` しか運ばないので、
					カテゴリ・エイリアス・センシティブは相手の REST API から取る。
					本番の実測では、リモート絵文字 19,129 件のうちそれらは 1 件も
					連合で入っていなかった。
				-->
				<MkInfo v-if="fetchState === 'fetching'">{{ i18n.ts.fetchingAsApObject }}</MkInfo>
				<MkInfo v-else-if="fetchState === 'unsupported'" warn>{{ i18n.ts._remoteEmojiImport.unsupported }}</MkInfo>
				<MkInfo v-else-if="fetchState === 'failed'" warn>{{ i18n.ts._remoteEmojiImport.fetchFailed }}</MkInfo>

				<MkInput v-model="category">
					<template #label>{{ i18n.ts.category }}</template>
				</MkInput>
				<MkInput v-model="aliases">
					<template #label>{{ i18n.ts.tags }}</template>
					<template #caption>{{ i18n.ts._remoteEmojiImport.aliasesCaption }}</template>
				</MkInput>
				<MkTextarea v-model="license">
					<template #label>{{ i18n.ts.license }}</template>
				</MkTextarea>
				<MkSwitch v-model="isSensitive">{{ i18n.ts.markAsSensitive }}</MkSwitch>
			</div>
		</div>
		<div :class="$style.footer">
			<MkButton primary rounded style="margin: 0 auto;" :disabled="fetchState === 'fetching'" @click="done">
				<i class="ti ti-plus"></i> {{ i18n.ts.import }}
			</MkButton>
		</div>
	</div>
</MkWindow>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkWindow from '@/components/MkWindow.vue';
import { emptyStrToEmptyArray } from '@/pages/admin/custom-emojis-manager.impl.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	emoji: {
		id: string,
		name: string,
		host: string,
		license: string | null,
		url: string
	},
}>();

const emit = defineEmits<{
	// 必要なら戻り値を増やす
	(ev: 'done'): void,
	(ev: 'closed'): void
}>();

const windowEl = useTemplateRef('windowEl');

const name = computed(() => props.emoji.name);
const host = computed(() => props.emoji.host);
const imgUrl = computed(() => props.emoji.url);

// 編集できる項目。**AP 経由で入っているのは license だけ**なので、他は空から始めて
// 取得結果で埋める。
const category = ref('');
const aliases = ref('');
const license = ref(props.emoji.license ?? '');
const isSensitive = ref(false);

// 取得の状態。`unsupported` は相手に per-name endpoint が無い場合 (Mastodon 系)。
// **失敗を異常として扱わない** — 手で埋めれば取り込めるので、理由を出して続行させる。
const fetchState = ref<'fetching' | 'done' | 'unsupported' | 'failed'>('fetching');

onMounted(async () => {
	try {
		// mk-go 独自のエンドポイントなので misskey-js の型集合には無い。
		// signup-applications.vue と同じ理由の cast。
		const res = await (misskeyApi('admin/emoji/fetch-remote-meta' as never, { emojiId: props.emoji.id } as never) as unknown as Promise<{
			fetched: boolean;
			reason?: string;
			category?: string;
			aliases?: string[];
			license?: string;
			isSensitive?: boolean;
		}>);
		if (!res.fetched) {
			fetchState.value = res.reason === 'unsupported' ? 'unsupported' : 'failed';
			return;
		}
		// **返ってきたキーだけを反映する。** 取れなかった項目はキーごと無いので、
		// ここで既存値 (license など) を消さない。
		if (res.category != null) category.value = res.category;
		if (res.aliases != null) aliases.value = res.aliases.join(' ');
		if (res.license != null) license.value = res.license;
		if (res.isSensitive != null) isSensitive.value = res.isSensitive;
		fetchState.value = 'done';
	} catch {
		fetchState.value = 'failed';
	}
});

async function done() {
	// **上書き項目は mk-go が足した additive パラメータ** (#2698) なので、
	// misskey-js の autogen 型 (`{ emojiId: string }`) には無い。upstream の
	// paramDef は emojiId のみ必須で、足しても既存の呼び出しは通る。
	await os.apiWithDialog('admin/emoji/copy' as never, {
		emojiId: props.emoji.id,
		category: category.value,
		aliases: emptyStrToEmptyArray(aliases.value),
		license: license.value,
		isSensitive: isSensitive.value,
	} as never);

	emit('done');
	windowEl.value?.close();
}
</script>

<style lang="scss" module>
.imgs {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	justify-content: center;
}

.imgContainer {
	padding: 8px;
	border-radius: 6px;
}

.img {
	display: block;
	height: 64px;
	width: 64px;
	object-fit: contain;
}

.footer {
	position: sticky;
	z-index: 10000;
	bottom: 0;
	left: 0;
	padding: 12px;
	border-top: solid 0.5px var(--MI_THEME-divider);
	background: color(from var(--MI_THEME-bg) srgb r g b / 0.5);
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
}
</style>
