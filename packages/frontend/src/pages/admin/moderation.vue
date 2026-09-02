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
					@update:modelValue="onChange_approvalRequiredForSignup"
				>
					<template #label>登録を承認制にする</template>
					<template #caption>
						<div>申請フォームに答えてもらい、承認した相手だけが登録できます。</div>
						<!--
							承認は内部で招待を発行して通すので、招待制と重ねると二重のゲートに
							意味が無い。メール必須との排他は #2571 で撤去した (承認済みの登録も
							確認メールの経路を通るようになったため)。
						-->
						<div v-if="emailRequiredForSignup">承認された相手には確認メールを送ります。</div>
						<div v-if="!enableRegistration && !approvalRequiredForSignup">
							有効にすると、アカウント作成も同時に開放されます。
						</div>
						<div v-else-if="approvalRequiredForSignup">
							申請は<MkA to="/admin/signup-applications" class="_link">登録申請</MkA>で確認できます。
						</div>
						<!--
							mk-go: 承認制を外すとゲートが 1 つも無くなるので、
							アカウント作成を閉じるかどうかを確認する (#2803)。
						-->
						<div v-if="approvalRequiredForSignup && enableRegistration">
							無効にすると、アカウント作成も閉じるかどうかを確認します。
						</div>
					</template>
				</MkSwitch>

				<!--
					mk-go: 申請フォームの項目 (#2570)。fediverse アカウントの欄など、
					聞きたいことを管理者が決める。**検証はしない** — 単なる自由記述。
				-->
				<MkFolder v-if="approvalRequiredForSignup" :defaultOpen="false">
					<template #icon><i class="ti ti-forms"></i></template>
					<template #label>申請フォームの項目</template>
					<template #suffix>{{ signupApplicationForm.length }} 項目</template>

					<div class="_gaps_m">
						<div v-if="signupApplicationForm.length === 0" style="font-size: 0.9em; opacity: 0.8;">
							項目を追加しないと、申請者は理由を書かずに申請することになります。
						</div>

						<div v-for="(field, i) in signupApplicationForm" :key="i" class="_gaps_s" :class="$style.formField">
							<MkInput v-model="field.label">
								<template #label>項目名</template>
							</MkInput>
							<MkSelect v-model="field.type" :items="fieldTypeDef">
								<template #label>入力欄</template>
							</MkSelect>
							<MkSwitch v-model="field.required">
								<template #label>必須にする</template>
							</MkSwitch>
							<MkButton danger inline @click="removeField(i)">
								<i class="ti ti-trash"></i> この項目を削除
							</MkButton>
						</div>

						<MkButton :disabled="signupApplicationForm.length >= maxFormFields" @click="addField">
							<i class="ti ti-plus"></i> 項目を追加
						</MkButton>
						<div v-if="signupApplicationForm.length >= maxFormFields" style="font-size: 0.9em; opacity: 0.8;">
							項目は{{ maxFormFields }}個までです。
						</div>

						<MkButton primary @click="saveSignupApplicationForm">
							<i class="ti ti-device-floppy"></i> 保存
						</MkButton>
					</div>
				</MkFolder>

				<SearchMarker :keywords="['email', 'required', 'signup']">
					<MkSwitch v-model="emailRequiredForSignup" @change="onChange_emailRequiredForSignup">
						<template #label><SearchLabel>{{ i18n.ts.emailRequiredForSignup }}</SearchLabel> ({{ i18n.ts.recommended }})</template>
						<template v-if="approvalRequiredForSignup" #caption>
							承認済みの登録にも確認メールを挟みます (#2571)。
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
import { ref, computed, toRaw } from 'vue';
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

// mk-go: 申請フォームの項目 (#2570)。上限はサーバー側 (ValidateForm) と揃える。
type SignupFormField = { label: string; type: 'text' | 'textarea'; required: boolean };
const maxFormFields = 10;
const signupApplicationForm = ref<SignupFormField[]>(
	Array.isArray((meta as unknown as Record<string, unknown>).signupApplicationForm)
		? structuredClone(toRaw((meta as unknown as Record<string, unknown>).signupApplicationForm)) as SignupFormField[]
		: []);

const fieldTypeDef = [
	{ label: '1 行', value: 'text' },
	{ label: '複数行', value: 'textarea' },
];

function addField() {
	if (signupApplicationForm.value.length >= maxFormFields) return;
	signupApplicationForm.value.push({ label: '', type: 'text', required: false });
}

function removeField(i: number) {
	signupApplicationForm.value.splice(i, 1);
}

function saveSignupApplicationForm() {
	os.apiWithDialog('admin/update-meta', {
		signupApplicationForm: signupApplicationForm.value,
	} as never).then(() => {
		fetchInstance(true);
	});
}

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
async function onChange_approvalRequiredForSignup(value: boolean) {
	const patch: Record<string, unknown> = { approvalRequiredForSignup: value };

	if (value) {
		// 承認制を入れるときはアカウント作成の開放も同じ更新で送る (#2565)。
		// **「先に開放してから承認制を入れる」順にすると、その間に素通しで登録
		// される窓ができる。** 承認制それ自体がゲートなので、開放は表示上の整合
		// (訪問者に「招待制」と出さない) のため。
		if (!enableRegistration.value) {
			patch.disableRegistration = false;
		}
	} else if (enableRegistration.value) {
		// 承認制を外すとゲートが 1 つも無くなる (#2803)。承認制で開いた登録が
		// そのまま残ると、誰でも登録できる状態が無警告で残る (アカウント作成の
		// トグル自体を入れるときは注意喚起を挟むのに、こちらは素通りしていた)。
		//
		// **どちらを選んだかを必ず明示して送る。** 省略するとサーバー側が閉じる
		// 側の既定を補うので (#2803)、「開けたままにする」が選べなくなる。
		//
		// 本文で結果を断定しない。primary は「閉じる」なので、断定すると直後の
		// ボタンが本文を打ち消す形になる。openRegistrationWarning はスイッチを
		// オンにする側の文面 (「…場合のみオンにすることを推奨します」) なので、
		// ここでは流用せず条件付きで書く。
		const { canceled, result } = await os.actions({
			type: 'warning',
			title: '承認制を解除しますか？',
			text: '解除すると申請と承認のゲートが無くなります。アカウント作成を開けたままにすると、誰でも登録できる状態になります。',
			actions: [
				{ value: 'close', text: 'アカウント作成も閉じる', primary: true },
				{ value: 'keep', text: 'アカウント作成は開けたままにする', danger: true },
				{ value: 'cancel', text: 'やめる' },
			],
		});
		if (canceled || result === 'cancel') return;
		patch.disableRegistration = result === 'close';
	} else {
		// 元から閉じているなら開く余地が無いので聞かない。それでも明示して送る
		// (要求だけを見れば結果が決まる形にしておく)。
		patch.disableRegistration = true;
	}

	// enableRegistration はページを開いた時点の meta から作った ref で、以後
	// 同期されない。**OFF 側は必ず disableRegistration を送るようになったので、
	// 開いている間に他の管理者が登録を閉じ / 開きしていると、その値を上書きする。**
	// 選択は管理者自身がダイアログで明示したものなので黙って倒れるわけではないが、
	// 判断材料が古くなりうる点は変わらない。

	const prevApproval = approvalRequiredForSignup.value;
	const prevRegistration = enableRegistration.value;
	approvalRequiredForSignup.value = value;
	if (typeof patch.disableRegistration === 'boolean') {
		enableRegistration.value = !patch.disableRegistration;
	}

	// **失敗したら表示を戻す (#2803)。** 楽観更新のまま放置すると、「閉じる」を
	// 選んで失敗したときに画面だけ招待制になり、実際には申請を受け付け続けている
	// のに管理者は止めたと読む。update-meta は保存に成功したら必ず 204 なので、
	// reject = 未保存として戻してよい。
	//
	// エラーの提示は apiWithDialog が担う。ただし通信断のように `err.code` が
	// 無い失敗ではその中の分岐が先に落ちてダイアログが出ない (upstream 由来。
	// ここでは直さない)。その場合もスイッチは実状態へ戻る。
	try {
		await os.apiWithDialog('admin/update-meta', patch as never);
	} catch {
		approvalRequiredForSignup.value = prevApproval;
		enableRegistration.value = prevRegistration;
		return;
	}
	fetchInstance(true);
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

<style lang="scss" module>
.formField {
	padding: 16px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
}
</style>
