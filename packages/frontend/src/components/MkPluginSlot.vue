<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="hasMounts" ref="rootEl" :class="$style.root"></div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onBeforeUnmount, useTemplateRef } from 'vue';
import { slotMounts, type SlotName, type SlotContext } from '@/plugin-api.js';

/*
 * サーバープラグインの描画先 (mk-go #2479)。
 *
 * プラグインには**素の DOM 要素だけ**を渡す。Vue のインスタンスを共有すると、
 * upstream の Vue 更新でプラグインが壊れるため。
 */
const props = defineProps<{
	name: SlotName;
	ctx?: SlotContext;
}>();

const rootEl = useTemplateRef('rootEl');

// 登録が無ければ要素ごと出さない (空の div で余白が生まれるのを防ぐ)。
const hasMounts = computed(() => slotMounts(props.name).length > 0);

const cleanups: (() => void)[] = [];

onMounted(() => {
	const el = rootEl.value;
	if (el == null) return;

	for (const { plugin, mount } of slotMounts(props.name)) {
		// プラグインごとに専用の container を渡す。同じ要素を共有させると、
		// 片方が innerHTML を書き換えて他方を消してしまう。
		const container = window.document.createElement('div');
		container.dataset.plugin = plugin;
		el.appendChild(container);

		try {
			// **1 つが落ちても他を止めない。** プラグインの不具合でページ全体が
			// 描画されない方が損害が大きい。
			const cleanup = mount(container, props.ctx ?? {});
			if (typeof cleanup === 'function') cleanups.push(cleanup);
		} catch (err) {
			console.error(`[plugin:${plugin}] slot ${props.name} の描画に失敗しました`, err);
		}
	}
});

onBeforeUnmount(() => {
	for (const cleanup of cleanups) {
		try {
			cleanup();
		} catch (err) {
			console.error('[plugin] 後片付けに失敗しました', err);
		}
	}
});
</script>

<style lang="scss" module>
.root {
	display: contents;
}
</style>
