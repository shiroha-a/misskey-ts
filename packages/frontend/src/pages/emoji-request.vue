<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px;">
		<!-- ===== 申請する ===== -->
		<div v-if="tab === 'apply'" class="_gaps">
			<MkInfo>{{ i18n.ts._emojiApplication.applyNote }}</MkInfo>

			<div :class="$style.preview">
				<div :class="$style.previewBox">
					<img v-if="file" :src="file.url" :alt="name" :class="$style.previewImg"/>
					<i v-else class="ti ti-photo" :class="$style.previewPlaceholder"></i>
				</div>
				<div :class="$style.previewMeta">
					<MkButton @click="chooseFile">{{ i18n.ts._emojiApplication.chooseImage }}</MkButton>
					<!--
						**本文中の実寸を見せる。** カスタム絵文字は本文では文字サイズの
						1.25 倍でしか描かれない。大きな升目だけを見て申請すると、細い線や
						小さな文字が潰れたものを出してしまう。
					-->
					<template v-if="file">
						<div :class="$style.previewLabel">{{ i18n.ts._emojiApplication.inlinePreview }}</div>
						<div :class="$style.inlineSample">
							{{ i18n.ts._emojiApplication.inlineSampleText }}
							<img :src="file.url" :alt="name" :class="$style.inlineImg"/>
						</div>
					</template>
					<div :class="$style.previewLabel">{{ i18n.ts._emojiApplication.imageHint }}</div>
				</div>
			</div>

			<MkInput v-model="name" :spellcheck="false">
				<template #label>{{ i18n.ts.name }}</template>
				<template #caption>{{ i18n.ts._emojiApplication.nameCaption }}</template>
			</MkInput>
			<MkInfo v-if="name !== '' && !nameValid" warn>{{ i18n.ts._emojiApplication.nameInvalid }}</MkInfo>

			<MkInput v-model="category">
				<template #label>{{ i18n.ts.category }}</template>
			</MkInput>
			<MkInput v-model="aliases">
				<template #label>{{ i18n.ts.tags }}</template>
				<template #caption>{{ i18n.ts._emojiApplication.aliasesCaption }}</template>
			</MkInput>
			<MkTextarea v-model="license">
				<template #label>{{ i18n.ts.license }}</template>
				<template #caption>{{ i18n.ts._emojiApplication.licenseCaption }}</template>
			</MkTextarea>
			<MkSwitch v-model="isSensitive">
				{{ i18n.ts.sensitive }}
			</MkSwitch>
			<MkTextarea v-model="comment">
				<template #label>{{ i18n.ts._emojiApplication.comment }}</template>
				<template #caption>{{ i18n.ts._emojiApplication.commentCaption }}</template>
			</MkTextarea>

			<MkButton primary :disabled="!canSubmit" @click="submit">
				{{ i18n.ts._emojiApplication.submit }}
			</MkButton>
		</div>

		<!-- ===== 自分の申請 ===== -->
		<div v-else class="_gaps">
			<MkLoading v-if="fetching"/>
			<MkInfo v-else-if="mine.length === 0">{{ i18n.ts._emojiApplication.noneOfMine }}</MkInfo>
			<div v-else class="_gaps_s">
				<MkFolder v-for="app in mine" :key="app.id" :defaultOpen="app.status === 'rejected'">
					<template #icon><i :class="app.remoteHost ? 'ti ti-world-download' : 'ti ti-mood-smile'"></i></template>
					<template #label><span class="_monospace">:{{ app.name }}:</span></template>
					<template #suffix>
						<span :class="[$style.status, $style[app.status]]">{{ statusLabel(app.status) }}</span>
					</template>

					<div class="_gaps_s">
						<MkKeyValue v-if="app.remoteHost" oneline>
							<template #key>{{ i18n.ts._emojiApplication.remoteSource }}</template>
							<template #value><span class="_monospace">:{{ app.remoteName }}:@{{ app.remoteHost }}</span></template>
						</MkKeyValue>
						<MkKeyValue oneline>
							<template #key>{{ i18n.ts.createdAt }}</template>
							<template #value><MkTime :time="app.createdAt" mode="detail"/></template>
						</MkKeyValue>
						<MkKeyValue v-if="app.processedAt" oneline>
							<template #key>{{ i18n.ts._emojiApplication.processedAt }}</template>
							<template #value><MkTime :time="app.processedAt" mode="detail"/></template>
						</MkKeyValue>
						<!--
							却下理由はモデレーターが書いた文面をそのまま出す。直して
							出し直すための唯一の手がかりなので、要約しない。
						-->
						<MkInfo v-if="app.rejectReason" warn>{{ app.rejectReason }}</MkInfo>
						<MkInfo v-else-if="app.status === 'approved'">
							{{ i18n.tsx._emojiApplication.approvedNote({ name: app.name }) }}
						</MkInfo>

						<MkButton v-if="app.status === 'pending'" danger @click="cancel(app)">
							{{ i18n.ts._emojiApplication.cancel }}
						</MkButton>
					</div>
				</MkFolder>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import MkTime from '@/components/global/MkTime.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { selectFile } from '@/utility/drive.js';
import * as os from '@/os.js';

type Application = {
	id: string;
	status: 'pending' | 'approved' | 'rejected' | 'canceled';
	name: string;
	rejectReason?: string;
	createdAt: string;
	processedAt: string | null;
	// kind = remote (#2935) のときだけ入る。
	remoteHost?: string;
	remoteName?: string;
};

// upstream の admin/emoji/add と同じ制約。**申請側で先に弾く** — 承認まで
// 通してから登録で落ちると、モデレーターが押した後にエラーになる。
const NAME_RE = /^[a-zA-Z0-9_]+$/;

const tab = ref<'apply' | 'mine'>('apply');
const headerTabs = computed(() => [{
	key: 'apply',
	title: i18n.ts._emojiApplication.tabApply,
}, {
	key: 'mine',
	title: i18n.ts._emojiApplication.tabMine,
}]);

const file = ref<{ id: string; url: string } | null>(null);
const name = ref('');
const category = ref('');
const aliases = ref('');
const license = ref('');
const isSensitive = ref(false);
const comment = ref('');

const mine = ref<Application[]>([]);
const fetching = ref(false);

const nameValid = computed(() => NAME_RE.test(name.value));
// ライセンスも必須。出典が辿れないと、問題が出たときに消すしか手が無くなる。
const canSubmit = computed(() => file.value != null && nameValid.value && license.value.trim() !== '');

async function chooseFile(ev: MouseEvent) {
	const selected = await selectFile({ anchorElement: ev.currentTarget ?? ev.target, multiple: false });
	file.value = { id: selected.id, url: selected.url };
}

async function submit() {
	try {
		await misskeyApi('emoji-application/create' as never, {
			name: name.value,
			category: category.value,
			aliases: aliases.value.split(/\s+/).filter(a => a !== ''),
			license: license.value,
			isSensitive: isSensitive.value,
			fileId: file.value?.id,
			comment: comment.value,
		} as never);
	} catch (err) {
		// **エラーの種別をそのまま出す。** 「失敗しました」だけだと、名前を
		// 直せばよいのか別の問題なのかが分からない。
		await os.alert({ type: 'error', text: submitErrorText(err) });
		return;
	}
	await os.alert({ type: 'success', text: i18n.ts._emojiApplication.submitted });
	file.value = null;
	name.value = '';
	category.value = '';
	aliases.value = '';
	license.value = '';
	isSensitive.value = false;
	comment.value = '';
	tab.value = 'mine';
}

function submitErrorText(err: unknown): string {
	const code = (err as { code?: string } | null)?.code;
	switch (code) {
		case 'DUPLICATE_NAME': return i18n.ts._emojiApplication.errorDuplicateName;
		case 'ALREADY_REQUESTED': return i18n.ts._emojiApplication.errorAlreadyRequested;
		case 'INVALID_EMOJI_NAME': return i18n.ts._emojiApplication.nameInvalid;
		case 'LICENSE_REQUIRED': return i18n.ts._emojiApplication.licenseCaption;
		case 'NO_SUCH_FILE': return i18n.ts._emojiApplication.errorNoFile;
		// H2 / M8 で create から新しく到達可能になった分。既定に落とすと
		// 「何か問題が」だけになり、直しようが分からない。
		case 'TOO_LONG': return i18n.ts._emojiApplication.errorTooLong;
		case 'UNSUPPORTED_FILE_TYPE': return i18n.ts._emojiApplication.errorUnsupportedType;
		// policy を持たない人が URL 直打ちで開いた場合。導線は設定側で隠して
		// いるが、ページ自体には gate が無い。
		case 'ROLE_PERMISSION_DENIED': return i18n.ts._emojiApplication.errorNotAllowed;
		// **レート制限は新しく到達可能になった (レビュー R2-M3)。** 汎用の
		// 「何かがおかしいようです」に潰すと、待てば通ることが分からない。
		case 'RATE_LIMIT_EXCEEDED': return i18n.ts._emojiApplication.errorRateLimited;
		default: return i18n.ts.somethingHappened;
	}
}

function statusLabel(status: Application['status']): string {
	switch (status) {
		case 'pending': return i18n.ts._emojiApplication.statusPending;
		case 'approved': return i18n.ts._emojiApplication.statusApproved;
		case 'rejected': return i18n.ts._emojiApplication.statusRejected;
		default: return i18n.ts._emojiApplication.statusCanceled;
	}
}

async function loadMine() {
	fetching.value = true;
	try {
		mine.value = await misskeyApi('emoji-application/list-mine' as never, { limit: 50 } as never) as unknown as Application[];
	} catch {
		mine.value = [];
		await os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	} finally {
		fetching.value = false;
	}
}

async function cancel(app: Application) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._emojiApplication.cancelConfirm,
	});
	if (canceled) return;
	try {
		await misskeyApi('emoji-application/cancel' as never, { applicationId: app.id } as never);
	} catch (err) {
		// 既に審査されていた場合など。黙って一覧を引き直すと「押しても何も
		// 起きない」ように見える。
		await os.alert({ type: 'error', text: cancelErrorText(err) });
	}
	await loadMine();
}

function cancelErrorText(err: unknown): string {
	switch ((err as { code?: string } | null)?.code) {
		case 'ALREADY_PROCESSED': return i18n.ts._emojiApplication.errorAlreadyProcessed;
		case 'NO_SUCH_APPLICATION': return i18n.ts._emojiApplication.errorNoSuchApplication;
		default: return i18n.ts.somethingHappened;
	}
}

watch(tab, (v) => {
	if (v === 'mine') void loadMine();
});

definePage(computed(() => ({
	title: i18n.ts._emojiApplication.title,
	icon: 'ti ti-mood-plus',
})));
</script>

<style lang="scss" module>
.status {
	font-size: 0.9em;
	font-weight: bold;
}
.pending { color: var(--MI_THEME-warn); }
.approved { color: var(--MI_THEME-success); }
.rejected { color: var(--MI_THEME-error); }
.canceled { opacity: 0.7; }

.preview {
	display: grid;
	grid-template-columns: 96px 1fr;
	gap: 16px;
	align-items: start;
	padding: 14px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: var(--MI-radius-sm);
}
.previewBox {
	width: 96px;
	height: 96px;
	display: grid;
	place-items: center;
	border-radius: var(--MI-radius-sm);
	background: var(--MI_THEME-bg);
}
.previewImg {
	max-width: 96px;
	max-height: 96px;
	object-fit: contain;
}
.previewPlaceholder {
	font-size: 32px;
	opacity: 0.4;
}
.previewMeta {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
}
.previewLabel {
	font-size: 0.85em;
	opacity: 0.75;
}
.inlineSample {
	line-height: 1.6;
}
.inlineImg {
	height: 1.25em;
	vertical-align: -0.25em;
}
</style>
