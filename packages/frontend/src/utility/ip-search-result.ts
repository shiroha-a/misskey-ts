/*
 * SPDX-FileCopyrightText: mk-go project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Decides what `admin/ip/accounts` results mean (#3104).
 *
 * **画面から切り出してある。** ここの判定を 2 度続けて間違えており
 * (1 周目は `hasMore` で分けて最後のページに嘘が残り、2 周目はページごとの
 * `droppedCount` を見て累積の一覧と食い違った)、どちらも読解でしか見つからな
 * かった。分岐そのものがこの機能の本体なので、純粋関数にして表で固定する。
 */

/** Subset of the endpoint response this module needs. */
export type IPSearchSnapshot = {
	loggingEnabled: boolean;
	hasAnyHistory: boolean;
	sinceDays: number;
	retentionDays: number;
	hasMore: boolean;
	/**
	 * How many of the target's own IPs the search was built from (#3105).
	 *
	 * **利用者を起点にする検索でだけ意味を持つ。** IP を直接指定する検索 (#3104)
	 * には起点という概念が無いので `undefined`。
	 *
	 * **0 のときは「一致が無かった」ではなく「比較していない」。** 対象の IP 記録が
	 * 窓の中に 1 件も無ければ候補側のクエリは 1 回も飛ばない。`hasAnyHistory` は
	 * テーブル全体を見る値なので、ここを見ないと**照合していないのに
	 * 「記録されていません」と断定する**。
	 */
	targetIPCount?: number;
	/**
	 * Whether the candidate set was cut short by a server-side cap (#3105).
	 *
	 * **立っているときは何も断定できない。** 見たのは全体の一部なので、
	 * 「一致が無い」も「これが上位」も言えない。
	 */
	truncated?: boolean;
};

/** Totals accumulated over every page fetched for one search. */
export type IPSearchTotals = {
	/** 表示できている候補の数 (全ページの累積)。 */
	accountCount: number;
	/** 利用者を解決できず落とした観測の数 (全ページの累積)。 */
	droppedCount: number;
	/** どれか 1 ページでも「記録はある」と答えたか。 */
	hasAnyHistory: boolean;
};

/**
 * Banner about the state of IP logging itself. `null` means nothing to say.
 *
 * **「記録が無効」と「結果がある」は同時に成り立つ** ので、結果の有無とは
 * 別に決める (#3066 §7)。
 */
export type IPSearchNotice = 'loggingDisabled' | 'loggingDisabledNoHistory' | 'noHistory' | null;

/**
 * What to show in place of (or alongside) the candidate list.
 *
 * `noTargetRecords` / `partial` は利用者を起点にする検索でだけ出る (#3105)。
 */
export type IPSearchOutcome =
	| 'accounts'
	| 'noTargetRecords'
	| 'noneOnThisPage'
	| 'noneResolvable'
	| 'partial'
	| 'noMatch'
	| 'noMatchInPeriod';

export function ipSearchNotice(snapshot: IPSearchSnapshot, totals: IPSearchTotals): IPSearchNotice {
	if (!snapshot.loggingEnabled) {
		return totals.hasAnyHistory ? 'loggingDisabled' : 'loggingDisabledNoHistory';
	}
	// **累積で見る。** ページを送っている間に掃除が走って最後のページが
	// 「記録は無い」と答えても、既に引けている一覧の上で記録を否定しない。
	return totals.hasAnyHistory ? null : 'noHistory';
}

export function ipSearchOutcome(snapshot: IPSearchSnapshot, totals: IPSearchTotals): IPSearchOutcome {
	if (totals.accountCount > 0) return 'accounts';
	if (!totals.hasAnyHistory) return 'accounts';
	// **起点が無ければ照合していない。** 対象の IP 記録が窓の中に 1 件も無ければ
	// 候補側のクエリは 1 回も飛ばないので、「一致が無い」とは言えない。
	// `hasAnyHistory` はテーブル全体を見る値なので、ここを見ないと**比較して
	// いないのに「記録されていません」と断定する** (#3105)。
	if (snapshot.targetIPCount === 0) return 'noTargetRecords';
	// **落としたものがあれば「記録されていない」とは言えない。** `user_ip` に
	// FK が無いので、アカウントを完全削除しても観測は残る。ここを `hasMore` で
	// 分けると、行数が limit 以下の最後のページで同じ嘘が残る。
	if (totals.droppedCount > 0) {
		return snapshot.hasMore ? 'noneOnThisPage' : 'noneResolvable';
	}
	// **打ち切った検索から「一致なし」を出さない。** 見たのは全体の一部なので、
	// 調べた範囲に無かったとしか言えない (#3105)。
	if (snapshot.truncated === true) return 'partial';
	// 窓が保持期間以上なら「残っている記録の全部を見た」と言える。
	return snapshot.sinceDays >= snapshot.retentionDays ? 'noMatch' : 'noMatchInPeriod';
}

/** Which message a failed request deserves. */
export type IPSearchErrorKind = 'notPermitted' | 'sessionExpired' | 'notAnIp' | 'pagingLimit' | 'networkFailed' | 'failed';

/**
 * Classifies a rejected `misskeyApi` call.
 *
 * **「サーバーのログを確認してください」へ倒してよいのは、サーバーが実際に
 * ログを残す場合だけ。** 403 も 401 も offset の打ち止めも通信断も何も残さない
 * ので、それぞれに手の打ちようのある案内を出す。
 *
 * @param first 初回の検索か (2 ページ目以降は入力欄と無関係)
 */
export function ipSearchErrorKind(err: unknown, first: boolean): IPSearchErrorKind {
	const code = errorCode(err);
	if (code === 'ROLE_PERMISSION_DENIED' || code === 'PERMISSION_DENIED') return 'notPermitted';
	if (code === 'CREDENTIAL_REQUIRED' || code === 'AUTHENTICATION_FAILED') return 'sessionExpired';
	if (code === 'INVALID_PARAM') {
		// ページング側の 400 は offset の上限にしか起きない。
		return first ? 'notAnIp' : 'pagingLimit';
	}
	// サーバーが返したエラーではない = 通信そのものが失敗した。
	if (code == null) return 'networkFailed';
	return 'failed';
}

function errorCode(err: unknown): string | null {
	if (typeof err !== 'object' || err == null || !('code' in err)) return null;
	const code = (err as { code: unknown }).code;
	return typeof code === 'string' ? code : null;
}
