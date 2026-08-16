<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/moderation" :label="i18n.ts.moderation" :keywords="['moderation']" icon="ti ti-shield" :inlining="['serverRules']">
			<div class="_gaps_m">
				<SearchMarker :keywords="['open', 'registration']">
					<MkSwitch :modelValue="enableRegistration" @update:modelValue="onChange_enableRegistration">
						<template #label><SearchLabel>{{ i18n.ts._serverSettings.openRegistration }}</SearchLabel></template>
						<template #caption>
							<div><SearchText>{{ i18n.ts._serverSettings.thisSettingWillAutomaticallyOffWhenModeratorsInactive }}</SearchText></div>
							<div><i class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i> <SearchText>{{ i18n.ts._serverSettings.openRegistrationWarning }}</SearchText></div>
						</template>
					</MkSwitch>
				</SearchMarker>

				<!--
					mk-go: 承認制の登録 (#2554 / #2557)。アカウント作成を開けたまま、
					申請と承認を必須にする。承認制それ自体がゲートなので、
					disableRegistration と組み合わせる必要は無い。
				-->
				<MkSwitch
					:modelValue="approvalRequiredForSignup"
					:disabled="!enableRegistration || emailRequiredForSignup"
					@update:modelValue="onChange_approvalRequiredForSignup"
				>
					<template #label>登録を承認制にする</template>
					<template #caption>
						<div>他の Misskey サーバーのアカウントを連絡先として申請してもらい、承認した相手だけが登録できます。</div>
						<!--
							承認は内部で招待を発行して通すので、招待制と重ねると二重のゲートに
							意味が無い。メール必須とは、承認フローがメール確認の経路を通らない
							ため実態と食い違う (#2565)。
						-->
						<div v-if="!enableRegistration">アカウント作成を開放しているときだけ設定できます。</div>
						<div v-else-if="emailRequiredForSignup">メールアドレス必須とは同時に設定できません。</div>
						<div v-else-if="approvalRequiredForSignup">
							申請は<MkA to="/admin/signup-applications" class="_link">登録申請</MkA>で確認できます。
						</div>
					</template>
				</MkSwitch>

				<SearchMarker :keywords="['email', 'required', 'signup']">
					<MkSwitch v-model="emailRequiredForSignup" :disabled="approvalRequiredForSignup" @change="onChange_emailRequiredForSignup">
						<template #label><SearchLabel>{{ i18n.ts.emailRequiredForSignup }}</SearchLabel> ({{ i18n.ts.recommended }})</template>
						<template v-if="approvalRequiredForSignup" #caption>
							承認制とは同時に設定できません (#2565)。
						</template>
					</MkSwitch>
				</SearchMarker>

				<SearchMarker :keywords="['ugc', 'content', 'visibility', 'visitor', 'guest']">
					<MkSelect v-model="ugcVisibilityForVisitor" :items="ugcVisibilityForVisitorDef" @update:modelValue="onChange_ugcVisibilityForVisitor">
						<template #label><SearchLabel>{{ i18n.ts._serverSettings.userGeneratedContentsVisibilityForVisitor }}</SearchLabel></template>
						<template #caption>
							<div><SearchText>{{ i18n.ts._serverSettings.userGeneratedContentsVisibilityForVisitor_description }}</SearchText></div>
							<div><i class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i> <SearchText>{{ i18n.ts._serverSettings.userGeneratedContentsVisibilityForVisitor_description2 }}</SearchText></div>
						</template>
					</MkSelect>
				</SearchMarker>

				<XServerRules/>

				<SearchMarker :keywords="['preserved', 'usernames']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-lock-star"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts.preservedUsernames }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="preservedUsernames">
								<template #caption>{{ i18n.ts.preservedUsernamesDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_preservedUsernames">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['sensitive', 'words']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-message-exclamation"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts.sensitiveWords }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="sensitiveWords">
								<template #caption>{{ i18n.ts.sensitiveWordsDescription }}<br>{{ i18n.ts.sensitiveWordsDescription2 }}</template>
							</MkTextarea>
							<MkButton primary @click="save_sensitiveWords">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['prohibited', 'words']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-message-x"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts.prohibitedWords }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="prohibitedWords">
								<template #caption>{{ i18n.ts.prohibitedWordsDescription }}<br>{{ i18n.ts.prohibitedWordsDescription2 }}</template>
							</MkTextarea>
							<MkButton primary @click="save_prohibitedWords">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['prohibited', 'name', 'user']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-user-x"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts.prohibitedWordsForNameOfUser }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="prohibitedWordsForNameOfUser">
								<template #caption>{{ i18n.ts.prohibitedWordsForNameOfUserDescription }}<br>{{ i18n.ts.prohibitedWordsDescription2 }}</template>
							</MkTextarea>
							<MkButton primary @click="save_prohibitedWordsForNameOfUser">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['hidden', 'tags', 'hashtags']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-eye-off"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts.hiddenTags }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="hiddenTags">
								<template #caption>{{ i18n.ts.hiddenTagsDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_hiddenTags">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['silenced', 'servers', 'hosts']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-eye-off"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts.silencedInstances }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="silencedHosts">
								<template #caption>{{ i18n.ts.silencedInstancesDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_silencedHosts">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['media', 'silenced', 'servers', 'hosts']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-eye-off"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts.mediaSilencedInstances }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="mediaSilencedHosts">
								<template #caption>{{ i18n.ts.mediaSilencedInstancesDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_mediaSilencedHosts">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['blocked', 'servers', 'hosts']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-ban"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts.blockedInstances }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="blockedHosts">
								<template #caption>{{ i18n.ts.blockedInstancesDescription }}</template>
							</MkTextarea>
							<MkButton primary @click="save_blockedHosts">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import * as Misskey from 'misskey-js';
import XServerRules from './server-rules.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkA from '@/components/global/MkA.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useMkSelect } from '@/composables/use-mkselect.js';
import MkButton from '@/components/MkButton.vue';
import FormLink from '@/components/form/link.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkSelect from '@/components/MkSelect.vue';

const meta = await misskeyApi('admin/meta');

const enableRegistration = ref(!meta.disableRegistration);
const approvalRequiredForSignup = ref(
	(meta as unknown as Record<string, unknown>).approvalRequiredForSignup === true);
const emailRequiredForSignup = ref(meta.emailRequiredForSignup);
const {
	model: ugcVisibilityForVisitor,
	def: ugcVisibilityForVisitorDef,
} = useMkSelect({
	items: [
		{ label: i18n.ts._serverSettings._userGeneratedContentsVisibilityForVisitor.all, value: 'all' },
		{ label: i18n.ts._serverSettings._userGeneratedContentsVisibilityForVisitor.localOnly, value: 'local' },
		{ label: i18n.ts._serverSettings._userGeneratedContentsVisibilityForVisitor.none, value: 'none' },
	],
	initialValue: meta.ugcVisibilityForVisitor,
});
const sensitiveWords = ref(meta.sensitiveWords.join('\n'));
const prohibitedWords = ref(meta.prohibitedWords.join('\n'));
const prohibitedWordsForNameOfUser = ref(meta.prohibitedWordsForNameOfUser.join('\n'));
const hiddenTags = ref(meta.hiddenTags.join('\n'));
const preservedUsernames = ref(meta.preservedUsernames.join('\n'));
const blockedHosts = ref(meta.blockedHosts.join('\n'));
const silencedHosts = ref(meta.silencedHosts?.join('\n') ?? '');
const mediaSilencedHosts = ref(meta.mediaSilencedHosts.join('\n'));

async function onChange_enableRegistration(value: boolean) {
	if (value) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.ts.acknowledgeNotesAndEnable,
		});
		if (canceled) return;
	}

	enableRegistration.value = value;

	// 承認制は登録開放が前提なので、閉じるときは同じ更新で一緒に落とす (#2565)。
	// **別々に送ると、サーバー側の検証に弾かれて「承認制を切らないと閉じられない」
	// 詰みになる。**
	const patch: Record<string, unknown> = { disableRegistration: !value };
	if (!value && approvalRequiredForSignup.value) {
		patch.approvalRequiredForSignup = false;
		approvalRequiredForSignup.value = false;
	}

	os.apiWithDialog('admin/update-meta', patch as never).then(() => {
		fetchInstance(true);
	});
}

// mk-go 独自の meta なので misskey-js の型集合には無い (#2557)。
function onChange_approvalRequiredForSignup(value: boolean) {
	approvalRequiredForSignup.value = value;
	os.apiWithDialog('admin/update-meta', {
		approvalRequiredForSignup: value,
	} as never).then(() => {
		fetchInstance(true);
	});
}

function onChange_emailRequiredForSignup(value: boolean) {
	os.apiWithDialog('admin/update-meta', {
		emailRequiredForSignup: value,
	}).then(() => {
		fetchInstance(true);
	});
}

function onChange_ugcVisibilityForVisitor(value: typeof ugcVisibilityForVisitor.value) {
	os.apiWithDialog('admin/update-meta', {
		ugcVisibilityForVisitor: value,
	}).then(() => {
		fetchInstance(true);
	});
}

function save_preservedUsernames() {
	os.apiWithDialog('admin/update-meta', {
		preservedUsernames: preservedUsernames.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_sensitiveWords() {
	os.apiWithDialog('admin/update-meta', {
		sensitiveWords: sensitiveWords.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_prohibitedWords() {
	os.apiWithDialog('admin/update-meta', {
		prohibitedWords: prohibitedWords.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_prohibitedWordsForNameOfUser() {
	os.apiWithDialog('admin/update-meta', {
		prohibitedWordsForNameOfUser: prohibitedWordsForNameOfUser.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_hiddenTags() {
	os.apiWithDialog('admin/update-meta', {
		hiddenTags: hiddenTags.value.split('\n'),
	}).then(() => {
		fetchInstance(true);
	});
}

function save_blockedHosts() {
	os.apiWithDialog('admin/update-meta', {
		blockedHosts: blockedHosts.value.split('\n') || [],
	}).then(() => {
		fetchInstance(true);
	});
}

function save_silencedHosts() {
	os.apiWithDialog('admin/update-meta', {
		silencedHosts: silencedHosts.value.split('\n') || [],
	}).then(() => {
		fetchInstance(true);
	});
}

function save_mediaSilencedHosts() {
	os.apiWithDialog('admin/update-meta', {
		mediaSilencedHosts: mediaSilencedHosts.value.split('\n') || [],
	}).then(() => {
		fetchInstance(true);
	});
}

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.moderation,
	icon: 'ti ti-shield',
}));
</script>
