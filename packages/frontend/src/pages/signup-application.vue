<!--
SPDX-FileCopyrightText: mk-go project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
	mk-go: 承認制の登録 (#2554 / #2556)。

	他の Misskey サーバーのアカウントを連絡先として申請し、審査を経て登録する。
	本人確認は MiAuth で行い、秘密の受け渡しはどこにも無い。承認結果の DM が
	届かなくても、このページに戻って続きから進められる。
-->
<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 600px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<div class="_gaps_m">
			<MkInfo v-if="fatal" warn>{{ fatal }}</MkInfo>

			<!-- 連絡先の確認前 -->
			<template v-if="contact == null">
				<div class="_gaps_s">
					<div>登録には、他の Misskey サーバーのアカウントを連絡先として登録する必要があります。</div>
					<div :class="$style.note">
						そのサーバーで認証を行います。<b>権限は一切要求しません。</b>アカウントを持っていることの確認だけに使います。
					</div>
				</div>

				<MkInput v-model="host" :disabled="busy" @enter="start">
					<template #label>連絡先アカウントのサーバー</template>
					<template #prefix><i class="ti ti-server"></i></template>
					<template #caption>例: misskey.io（<code>@name@misskey.io</code> の形でも構いません）</template>
				</MkInput>

				<MkButton primary rounded :disabled="busy || host.trim() === ''" @click="start">
					<i class="ti ti-external-link"></i> このサーバーで認証する
				</MkButton>

				<div :class="$style.note">
					Mastodon など Misskey 以外のサーバーではこの方法を使えません。
				</div>
			</template>

			<!-- 連絡先の確認後 -->
			<template v-else>
				<MkInfo>
					連絡先: <b>{{ contact.acct }}</b>
				</MkInfo>

				<!-- 申請していない / 再申請できる -->
				<template v-if="canApply">
					<MkInfo v-if="application?.status === 'rejected'" warn>
						この申請は承認されませんでした。
					</MkInfo>
					<MkInfo v-else-if="application?.status === 'expired'" warn>
						申請の期限が切れました。もう一度申請してください。
					</MkInfo>

					<MkTextarea v-model="reason" :disabled="busy">
						<template #label>申請理由</template>
						<template #caption>審査の参考にします。省略できます。</template>
					</MkTextarea>

					<MkButton primary rounded :disabled="busy" @click="apply">
						<i class="ti ti-send"></i> 申請する
					</MkButton>
				</template>

				<!-- 審査待ち -->
				<template v-else-if="application?.status === 'pending'">
					<MkInfo>
						申請を受け付けました。審査までしばらくお待ちください。
					</MkInfo>
					<div :class="$style.note">
						結果はこのページで確認できます。
						<template v-if="application.expiresAt">
							この申請は<MkTime :time="application.expiresAt" mode="detail"/>まで有効です。
						</template>
					</div>
					<MkButton rounded :disabled="busy" @click="refresh">
						<i class="ti ti-refresh"></i> 状態を確認する
					</MkButton>
				</template>

				<!-- 承認済み。ここで初めてアカウントを作る -->
				<template v-else-if="application?.status === 'approved'">
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

				<!-- 登録済み -->
				<template v-else-if="application?.status === 'completed'">
					<MkInfo>この連絡先ではすでに登録が完了しています。</MkInfo>
				</template>
			</template>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { login } from '@/accounts.js';

type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'completed';

type ApplicationView = {
	status: ApplicationStatus;
	reason: string | null;
	createdAt: string;
	expiresAt: string;
};

type ContactView = {
	host: string;
	username: string;
	acct: string;
	name: string;
	avatarUrl: string;
};

// mk-go 独自のエンドポイントなので misskey-js の型集合には無い。
// server-plugins.vue と同じ理由の cast。
function api<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
	return misskeyApi(endpoint as never, params as never) as unknown as Promise<T>;
}

// トークンは同じタブの中だけで持ち回す。**localStorage に置くと、共有端末で
// 別の人がそのまま続きを操作できる。**
const TOKEN_KEY = 'mkgo:signup-application:token';

const host = ref('');
const reason = ref('');
const username = ref('');
const password = ref('');
const busy = ref(false);
const fatal = ref<string | null>(null);
const contact = ref<ContactView | null>(null);
const application = ref<ApplicationView | null>(null);

// 申請できるのは「まだ無い」「却下された」「期限切れ」のとき。**却下や期限切れの
// 後に申請し直せることが、連絡先を失った人以外の唯一の回復手段になる。**
const canApply = computed(() => application.value == null
	|| application.value.status === 'rejected'
	|| application.value.status === 'expired');

function message(err: unknown): string {
	const code = (err as { code?: string } | null)?.code;
	switch (code) {
		case 'NOT_MISSKEY_HOST': return 'そのサーバーは Misskey ではないようです。Misskey 系のサーバーを指定してください。';
		case 'INVALID_HOST': return 'サーバーの指定が正しくありません。';
		case 'NOT_AUTHORIZED': return '認証が完了しませんでした。もう一度やり直してください。';
		case 'NOT_LOCAL_ACCOUNT': return 'そのアカウントは指定したサーバーのものではありません。';
		case 'SESSION_EXPIRED': return '認証の有効期限が切れました。最初からやり直してください。';
		case 'ALREADY_APPLIED': return 'この連絡先ではすでに申請が進行中です。';
		case 'REASON_TOO_LONG': return '申請理由が長すぎます。';
		case 'NOT_APPROVED': return 'この申請はまだ承認されていません。';
		case 'UNAVAILABLE': return 'このサーバーでは承認制の登録を受け付けていません。';
		default: return '処理に失敗しました。時間をおいて試してください。';
	}
}

async function start() {
	busy.value = true;
	fatal.value = null;
	try {
		const res = await api<{ token: string; url: string }>(
			'signup-application/miauth/start', { host: host.value });
		// **リダイレクトの前に保存する。** 保存前に飛ぶと、戻ってきたときに
		// どのフローだったか分からなくなる。
		window.sessionStorage.setItem(TOKEN_KEY, res.token);
		window.location.href = res.url;
	} catch (err) {
		fatal.value = message(err);
	} finally {
		busy.value = false;
	}
}

// コールバックから戻ってきたときの処理。
//
// **URL の session は使わない。** どのフローかは自分が保存したトークンで決まる。
// URL 経由の値を信じると、攻撃者が開始したフローを踏まされる筋が残る。
async function complete() {
	const token = window.sessionStorage.getItem(TOKEN_KEY);
	if (token == null) {
		fatal.value = '認証の情報が見つかりませんでした。最初からやり直してください。';
		return;
	}
	busy.value = true;
	try {
		const res = await api<{ token: string; contact: ContactView; application: ApplicationView | null }>(
			'signup-application/miauth/complete', { token });
		window.sessionStorage.setItem(TOKEN_KEY, res.token);
		contact.value = res.contact;
		application.value = res.application;
	} catch (err) {
		window.sessionStorage.removeItem(TOKEN_KEY);
		fatal.value = message(err);
	} finally {
		busy.value = false;
	}
}

async function refresh() {
	const token = window.sessionStorage.getItem(TOKEN_KEY);
	if (token == null) return;
	busy.value = true;
	try {
		const res = await api<{ contact: ContactView; application: ApplicationView | null }>(
			'signup-application/status', { token });
		contact.value = res.contact;
		application.value = res.application;
	} catch (err) {
		fatal.value = message(err);
	} finally {
		busy.value = false;
	}
}

async function apply() {
	const token = window.sessionStorage.getItem(TOKEN_KEY);
	if (token == null) return;
	busy.value = true;
	fatal.value = null;
	try {
		const res = await api<{ application: ApplicationView }>(
			'signup-application/apply', { token, reason: reason.value });
		application.value = res.application;
	} catch (err) {
		fatal.value = message(err);
	} finally {
		busy.value = false;
	}
}

async function register() {
	const token = window.sessionStorage.getItem(TOKEN_KEY);
	if (token == null) return;
	busy.value = true;
	fatal.value = null;
	try {
		const res = await api<{ id: string; token: string }>(
			'signup-application/register',
			{ token, username: username.value, password: password.value });
		// 登録が済んだらトークンは用済み。
		window.sessionStorage.removeItem(TOKEN_KEY);
		await os.alert({ type: 'success', text: 'アカウントを作成しました。' });
		await login(res.token);
	} catch (err) {
		fatal.value = message(err);
	} finally {
		busy.value = false;
	}
}

onMounted(() => {
	// コールバックから戻ってきた場合は続きを実行する。それ以外でも、保存済みの
	// トークンがあれば状態を引き直す — **承認 DM が届かなくても、このページに
	// 来れば続きから進める**ようにするため。
	if (window.location.pathname.endsWith('/callback')) {
		void complete();
	} else if (window.sessionStorage.getItem(TOKEN_KEY) != null) {
		void refresh();
	}
});

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
