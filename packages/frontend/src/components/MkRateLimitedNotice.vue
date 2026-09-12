<!--
SPDX-FileCopyrightText: mk-go project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="paginator.rateLimited.value" :class="$style.root">
	<MkInfo warn>{{ i18n.ts.rateLimitExceeded }}</MkInfo>
	<MkButton rounded :disabled="cooling" @click="retry">
		{{ cooling ? i18n.ts.rateLimitCooldown : i18n.ts.retry }}
	</MkButton>
</div>
</template>

<script lang="ts" setup>
import { ref, onBeforeUnmount } from 'vue';
import MkInfo from '@/components/MkInfo.vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import type { IPaginator } from '@/utility/paginator.js';

/*
 * mk-go: レート制限に当たったことを利用者に伝える (#2955)。
 *
 * **自動追い読みを持つすべての場所で使う。** 当初は `MkPagination` にだけ
 * 置いていたが、`i/notifications` は `MkStreamingNotificationsTimeline` が独自のボタンを持ち
 * `MkPagination` を経由しない。**そちらでは理由が出ず、ボタンが黙って消える
 * だけ**になっていた。利用者は「これで全部」と誤解する。
 *
 * **再試行には冷却を置く。** サーバー側の制限は拒否も記録するので、**押すほど
 * 窓が延びる**。待ち時間そのものは出せない — `Retry-After` は HTTP ヘッダに
 * しかなく、`misskeyApi` は `Response` を捨てて `body.error` だけを reject
 * するため、クライアントからは読めない (サーバー側で body に載せる変更が要る)。
 */
const props = defineProps<{
	paginator: IPaginator;
}>();

const COOLDOWN_MS = 15000;

const cooling = ref(false);
let timer: number | null = null;

onBeforeUnmount(() => {
	if (timer != null) window.clearTimeout(timer);
});

function retry(): void {
	// **判断は Paginator 側にある。** ここは冷却だけを持つ薄い view に留める
	// (コンポーネントは単体テストから駆動できないので、向きの扱いを置くと
	// 取り違えても誰も落ちない)。
	cooling.value = true;
	timer = window.setTimeout(() => { cooling.value = false; }, COOLDOWN_MS);
	props.paginator.retryAfterRateLimit();
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	margin: 8px 0;
}
</style>
