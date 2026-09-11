<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_spacer" style="--MI_SPACER-w: 800px;">
	<div class="_gaps">
		<MkSelect v-model="filter" :items="filterDef">
			<template #label>{{ i18n.ts.state }}</template>
		</MkSelect>

		<MkLoading v-if="fetching"/>
		<MkInfo v-else-if="applications.length === 0">{{ i18n.ts._emojiApplication.noApplications }}</MkInfo>

		<div v-else class="_gaps_s">
			<MkFolder v-for="app in applications" :key="app.id" :defaultOpen="filter === 'pending'">
				<template #icon><i class="ti ti-mood-smile"></i></template>
				<template #label><span class="_monospace">:{{ app.name }}:</span></template>
				<template #suffix>
					<span :class="[$style.status, $style[app.status]]">{{ statusLabel(app.status) }}</span>
				</template>

				<div class="_gaps_s">
					<!--
						**名前の重複を承認より前に出す。** 押してから DUPLICATE_NAME で
						落ちると、押した側にも申請者にも何も残らない。nameConflict が
						null なのは「DB 障害で確認できなかった」で、重複なし (false) とは
						別物として扱う。
					-->
					<MkInfo v-if="app.nameConflict" warn>
						{{ i18n.tsx._emojiApplication.nameConflict({ name: app.name }) }}
					</MkInfo>
					<MkInfo v-else-if="app.nameConflict === null" warn>
						{{ i18n.ts._emojiApplication.nameConflictUnknown }}
					</MkInfo>

					<div :class="$style.preview">
						<div :class="$style.previewBox">
							<img v-if="app.url" :src="app.url" :alt="app.name" :class="$style.previewImg"/>
							<!--
								**null は「確認できなかった」。** 空文字 (申請者が消した) と
								区別する — 障害中に「画像がありません」と出すと、実際には
								存在する申請を却下しうる。
							-->
							<span v-else-if="app.url === null" :class="$style.previewGone">{{ i18n.ts._emojiApplication.imageUnknown }}</span>
							<span v-else :class="$style.previewGone">{{ i18n.ts._emojiApplication.imageGone }}</span>
						</div>
						<div :class="$style.previewMeta">
							<!--
								**本文中の実寸を併記する。** 大きな升目だけで審査すると、
								本文で潰れて読めない絵文字を通してしまう。カスタム絵文字は
								本文では文字サイズの 1.25 倍でしか描かれない。
							-->
							<div :class="$style.previewLabel">{{ i18n.ts._emojiApplication.inlinePreview }}</div>
							<div v-if="app.url" :class="$style.inlineSample">
								{{ i18n.ts._emojiApplication.inlineSampleText }}
								<img :src="app.url" :alt="app.name" :class="$style.inlineImg"/>
							</div>
							<div v-if="app.fileType" :class="$style.previewType">{{ app.fileType }}</div>
						</div>
					</div>

					<MkKeyValue oneline>
						<template #key>{{ i18n.ts._emojiApplication.applicant }}</template>
						<template #value><MkA :to="`/admin/user/${app.userId}`">{{ app.userId }}</MkA></template>
					</MkKeyValue>
					<MkKeyValue oneline>
						<template #key>{{ i18n.ts.createdAt }}</template>
						<template #value><MkTime :time="app.createdAt" mode="detail"/></template>
					</MkKeyValue>
					<MkKeyValue v-if="app.category" oneline>
						<template #key>{{ i18n.ts.category }}</template>
						<template #value>{{ app.category }}</template>
					</MkKeyValue>
					<MkKeyValue v-if="app.aliases.length > 0" oneline>
						<template #key>{{ i18n.ts.tags }}</template>
						<template #value>{{ app.aliases.join(' ') }}</template>
					</MkKeyValue>
					<MkKeyValue oneline>
						<template #key>{{ i18n.ts.license }}</template>
						<template #value>{{ app.license }}</template>
					</MkKeyValue>
					<MkKeyValue oneline>
						<template #key>{{ i18n.ts.sensitive }}</template>
						<template #value>{{ app.isSensitive ? i18n.ts.yes : i18n.ts.no }}</template>
					</MkKeyValue>
					<MkKeyValue v-if="app.comment" oneline>
						<template #key>{{ i18n.ts._emojiApplication.comment }}</template>
						<template #value>{{ app.comment }}</template>
					</MkKeyValue>
					<MkKeyValue v-if="app.rejectReason" oneline>
						<template #key>{{ i18n.ts._emojiApplication.rejectReason }}</template>
						<template #value>{{ app.rejectReason }}</template>
					</MkKeyValue>

					<template v-if="app.status === 'pending'">
						<MkTextarea v-model="reasons[app.id]">
							<template #label>{{ i18n.ts._emojiApplication.rejectReason }}</template>
							<template #caption>{{ i18n.ts._emojiApplication.rejectReasonCaption }}</template>
						</MkTextarea>
						<div :class="$style.actions">
							<MkButton primary :disabled="busy === app.id" @click="approve(app)">
								{{ i18n.ts._emojiApplication.approve }}
							</MkButton>
							<MkButton danger :disabled="busy === app.id" @click="reject(app)">
								{{ i18n.ts._emojiApplication.reject }}
							</MkButton>
						</div>
					</template>
				</div>
			</MkFolder>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import MkTime from '@/components/global/MkTime.vue';
import MkA from '@/components/global/MkA.vue';
import { i18n } from '@/i18n.js';
import { useMkSelect } from '@/composables/use-mkselect.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import * as os from '@/os.js';

type Application = {
	id: string;
	userId: string;
	status: 'pending' | 'approved' | 'rejected' | 'canceled';
	name: string;
	category: string | null;
	aliases: string[];
	license: string;
	isSensitive: boolean;
	comment: string | null;
	rejectReason?: string;
	createdAt: string;
	// null = 確認できなかった (DB 障害)。空文字 = 申請者が drive から消した。
	url: string | null;
	fileType: string | null;
	// true = 同名あり / false = なし / null = 確認できなかった (DB 障害)。
	// **null を false と同一視しない** — 確認できていないことを隠すと、
	// 承認を押してから落ちる。
	nameConflict?: { emojiId: string; createdAt: string | null } | false | null;
};

// MkSelect は items API を使う (option 子要素は受け付けない)。
const { model: filter, def: filterDef } = useMkSelect({
	items: [
		{ label: i18n.ts._emojiApplication.filterPending, value: 'pending' },
		{ label: i18n.ts._emojiApplication.filterProcessed, value: 'processed' },
		{ label: i18n.ts.all, value: 'all' },
	],
	initialValue: 'pending',
});
const applications = ref<Application[]>([]);
const reasons = ref<Record<string, string>>({});
const fetching = ref(true);
const busy = ref<string | null>(null);

function statusLabel(status: Application['status']): string {
	switch (status) {
		case 'pending': return i18n.ts._emojiApplication.statusPending;
		case 'approved': return i18n.ts._emojiApplication.statusApproved;
		case 'rejected': return i18n.ts._emojiApplication.statusRejected;
		default: return i18n.ts._emojiApplication.statusCanceled;
	}
}

async function load() {
	fetching.value = true;
	try {
		applications.value = await misskeyApi('admin/emoji-application/list' as never, {
			filter: filter.value,
			limit: 50,
		} as never) as unknown as Application[];
	} catch (err) {
		// 一覧が引けなかったことを黙らせない。空の一覧と区別が付かなくなる。
		applications.value = [];
		await os.alert({ type: 'error', text: reviewErrorText(err) });
	} finally {
		fetching.value = false;
	}
}

// reviewErrorText maps the API error code onto a message.
//
// 種別を潰さない。「失敗しました」だけだと、名前の重複なのか画像が消えたのか、
// 他のモデレーターが先に処理したのかが分からない。
function reviewErrorText(err: unknown): string {
	switch ((err as { code?: string } | null)?.code) {
		case 'DUPLICATE_NAME': return i18n.ts._emojiApplication.errorDuplicateName;
		case 'ALREADY_PROCESSED': return i18n.ts._emojiApplication.errorAlreadyProcessed;
		case 'UNSUPPORTED_FILE_TYPE': return i18n.ts._emojiApplication.errorUnsupportedType;
		case 'NO_SUCH_FILE': return i18n.ts._emojiApplication.errorFileGone;
		default: return i18n.ts.somethingHappened;
	}
}

watch(filter, load, { immediate: true });

async function approve(app: Application) {
	// **重複があるなら押す前に止める。** backend も承認の直前に見ているが、
	// そこで落とすとモデレーターには「なぜか失敗した」としか見えない。
	if (app.nameConflict) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.tsx._emojiApplication.nameConflictConfirm({ name: app.name }),
		});
		if (canceled) return;
	}
	busy.value = app.id;
	try {
		await misskeyApi('admin/emoji-application/approve' as never, { applicationId: app.id } as never);
		await load();
	} catch (err) {
		// **握り潰さない。** backend は DUPLICATE_NAME / UNSUPPORTED_FILE_TYPE /
		// NO_SUCH_FILE / ALREADY_PROCESSED を種別ごとに返しているのに、catch が
		// 無いと misskeyApi の reject がどこにも出ず、ボタンが戻るだけになる
		// (本番では unhandledrejection のハンドラが _DEV_ の中にあるため無反応)。
		await os.alert({ type: 'error', text: reviewErrorText(err) });
		await load();
	} finally {
		busy.value = null;
	}
}

async function reject(app: Application) {
	const reason = (reasons.value[app.id] ?? '').trim();
	// **理由なしの却下を止める。** 申請者にはこの文面しか届かないので、空だと
	// 「駄目でした」だけが残り、直して出し直す手がかりが無い。
	if (reason === '') {
		await os.alert({
			type: 'warning',
			text: i18n.ts._emojiApplication.rejectReasonRequired,
		});
		return;
	}
	busy.value = app.id;
	try {
		await misskeyApi('admin/emoji-application/reject' as never, {
			applicationId: app.id,
			reason,
		} as never);
		delete reasons.value[app.id];
		await load();
	} catch (err) {
		await os.alert({ type: 'error', text: reviewErrorText(err) });
		await load();
	} finally {
		busy.value = null;
	}
}
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
.previewGone {
	font-size: 0.8em;
	text-align: center;
	opacity: 0.7;
}
.previewMeta {
	display: flex;
	flex-direction: column;
	gap: 6px;
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
.previewType {
	font-size: 0.8em;
	opacity: 0.75;
}

.actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}
</style>
