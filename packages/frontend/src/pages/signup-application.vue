<!--
SPDX-FileCopyrightText: mk-go project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
	mk-go: 承認制の登録 (#2568 / #2569)。

	申請してクレームコードを受け取り、そのコードで戻ってきて登録する。**外部の
	サーバーには一切触れない。** コードは 1 度しか表示されず、失くしたら再申請。
-->
<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 600px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<div class="_gaps_m">
			<MkInfo v-if="fatal" warn>{{ fatal }}</MkInfo>

			<!-- 申請直後: コードを 1 度だけ見せる -->
			<template v-if="issuedCode">
				<MkInfo warn>
					<div><b>このコードを控えてください。</b>二度と表示されません。</div>
					<div>登録の状況を確認したり、承認後に登録したりするのに必要です。失くした場合は申請し直してください。</div>
				</MkInfo>
				<MkInput v-model="issuedCode" readonly>
					<template #label>クレームコード</template>
				</MkInput>
				<MkButton primary rounded @click="beginLookup">
					<i class="ti ti-check"></i> 控えました
				</MkButton>
			</template>

			<!-- 申請の状態を表示 -->
			<template v-else-if="application">
				<template v-if="application.status === 'pending'">
					<MkInfo>申請を受け付けました。審査までしばらくお待ちください。</MkInfo>
					<div :class="$style.note">
						結果はこのページでコードを入力すると確認できます。
						<template v-if="application.expiresAt">
							この申請は<MkTime :time="application.expiresAt" mode="detail"/>まで有効です。
						</template>
					</div>
					<MkButton rounded :disabled="busy" @click="refresh">
						<i class="ti ti-refresh"></i> 状態を確認する
					</MkButton>
				</template>

				<template v-else-if="application.status === 'approved'">
					<MkInfo>申請が承認されました。アカウントを作成してください。</MkInfo>

					<MkInput v-model="username" :disabled="busy" pattern="^[a-zA-Z0-9_]+$">
						<template #label>{{ i18n.ts.username }}</template>
						<template #prefix>@</template>
					</MkInput>
					<MkInput v-model="password" type="password" :disabled="busy">
						<template #label>{{ i18n.ts.password }}</template>
						<template #prefix><i class="ti ti-lock"></i></template>
					</MkInput>

					<MkButton primary rounded :disabled="busy || username === '' || password === ''" @click="register">
						<i class="ti ti-user-plus"></i> {{ i18n.ts.signup }}
					</MkButton>
				</template>

				<template v-else-if="application.status === 'rejected'">
					<MkInfo warn>この申請は承認されませんでした。</MkInfo>
					<MkButton rounded @click="restart">もう一度申請する</MkButton>
				</template>

				<template v-else-if="application.status === 'expired'">
					<MkInfo warn>申請の期限が切れました。</MkInfo>
					<MkButton rounded @click="restart">もう一度申請する</MkButton>
				</template>

				<template v-else-if="application.status === 'completed'">
					<MkInfo>この申請では既に登録が完了しています。</MkInfo>
				</template>
			</template>

			<!-- 入口: 申請する / コードで戻る -->
			<template v-else>
				<div class="_gaps_s">
					<div>このサーバーの登録は承認制です。申請すると管理者が確認します。</div>
					<div :class="$style.note">
						申請するとクレームコードが 1 度だけ表示されます。<b>結果の確認と登録に必要なので、必ず控えてください。</b>
					</div>
				</div>

				<MkFolder :defaultOpen="true">
					<template #icon><i class="ti ti-send"></i></template>
					<template #label>申請する</template>

					<div class="_gaps_m">
						<MkTextarea v-model="reason" :disabled="busy">
							<template #label>申請理由</template>
							<template #caption>審査の参考にします。</template>
						</MkTextarea>
						<MkCaptcha v-if="captchaProvider" v-model="captchaResponse" :provider="captchaProvider" :sitekey="captchaSiteKey"/>
						<MkButton primary rounded :disabled="busy" @click="apply">
							<i class="ti ti-send"></i> 申請する
						</MkButton>
					</div>
				</MkFolder>

				<MkFolder :defaultOpen="false">
					<template #icon><i class="ti ti-key"></i></template>
					<template #label>コードで状況を確認する</template>

					<div class="_gaps_m">
						<MkInput v-model="claimCode" :disabled="busy" @enter="refresh">
							<template #label>クレームコード</template>
						</MkInput>
						<MkButton rounded :disabled="busy || claimCode === ''" @click="refresh">
							<i class="ti ti-search"></i> 確認する
						</MkButton>
					</div>
				</MkFolder>
			</template>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkCaptcha from '@/components/MkCaptcha.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { login } from '@/accounts.js';

type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'completed';

type ApplicationView = {
	status: ApplicationStatus;
	reason: string | null;
	createdAt: string;
	expiresAt: string;
};

// mk-go 独自のエンドポイントなので misskey-js の型集合には無い。
// server-plugins.vue と同じ理由の cast。
function api<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
	return misskeyApi(endpoint as never, params as never) as unknown as Promise<T>;
}

const reason = ref('');
const claimCode = ref('');
const issuedCode = ref('');
const username = ref('');
const password = ref('');
const busy = ref(false);
const fatal = ref<string | null>(null);
const application = ref<ApplicationView | null>(null);
const captchaResponse = ref<string | null>(null);

// 有効な captcha があればそれを使う。**申請フォームは誰でも叩けるので、ここが
// 唯一の防波堤になる** — 連絡先という自然キーが無くなり、重複申請を DB で抑止
// できなくなったため (#2569)。
const captchaProvider = computed(() => {
	if (instance.enableHcaptcha) return 'hcaptcha';
	if (instance.enableRecaptcha) return 'recaptcha';
	if (instance.enableTurnstile) return 'turnstile';
	if (instance.enableMcaptcha) return 'mcaptcha';
	if (instance.enableTestcaptcha) return 'testcaptcha';
	return null;
});

const captchaSiteKey = computed(() => {
	switch (captchaProvider.value) {
		case 'hcaptcha': return instance.hcaptchaSiteKey;
		case 'recaptcha': return instance.recaptchaSiteKey;
		case 'turnstile': return instance.turnstileSiteKey;
		case 'mcaptcha': return instance.mcaptchaSiteKey;
		default: return null;
	}
});

function captchaParams(): Record<string, unknown> {
	if (captchaProvider.value == null || captchaResponse.value == null) return {};
	switch (captchaProvider.value) {
		case 'hcaptcha': return { 'hcaptcha-response': captchaResponse.value };
		case 'recaptcha': return { 'g-recaptcha-response': captchaResponse.value };
		case 'turnstile': return { 'turnstile-response': captchaResponse.value };
		case 'mcaptcha': return { 'm-captcha-response': captchaResponse.value };
		default: return { 'testcaptcha-response': captchaResponse.value };
	}
}

function message(err: unknown): string {
	const code = (err as { code?: string } | null)?.code;
	switch (code) {
		case 'NO_SUCH_APPLICATION': return 'そのコードの申請は見つかりませんでした。入力を確認してください。';
		case 'NOT_APPROVED': return 'この申請はまだ承認されていません。';
		case 'REASON_TOO_LONG': return '申請理由が長すぎます。';
		case 'CAPTCHA_FAILED': return '認証に失敗しました。やり直してください。';
		case 'UNAVAILABLE': return 'このサーバーでは承認制の登録を受け付けていません。';
		case 'INVALID_USERNAME': return 'そのユーザー名は使えません。';
		case 'USED_USERNAME': return 'そのユーザー名は既に使われています。';
		default: return '処理に失敗しました。時間をおいて試してください。';
	}
}

async function apply() {
	busy.value = true;
	fatal.value = null;
	try {
		const res = await api<{ claimCode: string; application: ApplicationView }>(
			'signup-application/apply', { reason: reason.value, ...captchaParams() });
		// **コードを表示するのはここだけ。** サーバーは hash しか持っていない。
		issuedCode.value = res.claimCode;
		claimCode.value = res.claimCode;
		application.value = res.application;
	} catch (err) {
		fatal.value = message(err);
	} finally {
		busy.value = false;
	}
}

// 「控えました」を押したら、控えたコードで状態表示へ移る。
function beginLookup() {
	issuedCode.value = '';
}

async function refresh() {
	if (claimCode.value === '') return;
	busy.value = true;
	fatal.value = null;
	try {
		const res = await api<{ application: ApplicationView }>(
			'signup-application/status', { claimCode: claimCode.value });
		application.value = res.application;
	} catch (err) {
		application.value = null;
		fatal.value = message(err);
	} finally {
		busy.value = false;
	}
}

function restart() {
	application.value = null;
	claimCode.value = '';
	reason.value = '';
	fatal.value = null;
}

async function register() {
	busy.value = true;
	fatal.value = null;
	try {
		const res = await api<{ id: string; token: string }>(
			'signup-application/register',
			{ claimCode: claimCode.value, username: username.value, password: password.value });
		await os.alert({ type: 'success', text: 'アカウントを作成しました。' });
		await login(res.token);
	} catch (err) {
		fatal.value = message(err);
	} finally {
		busy.value = false;
	}
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: '登録の申請',
	icon: 'ti ti-user-plus',
}));
</script>

<style lang="scss" module>
.note {
	font-size: 0.9em;
	opacity: 0.8;
}
</style>
