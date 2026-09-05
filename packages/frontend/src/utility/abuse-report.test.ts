/*
 * SPDX-FileCopyrightText: mk-go project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import {
	ABUSE_REPORT_COMMENT_MAX,
	buildAbuseReportComment,
	buildContextFromNote,
	countRunes,
	isAbuseReportFormValid,
	type AbuseReportFormValues,
} from './abuse-report.js';

const formLocale = {
	category: '違反カテゴリ',
	categoryRequired: '',
	targetUser: '対象ユーザー',
	url: '該当URL',
	when: '発生日時',
	details: '詳細',
	detailsRequired: '',
	detailsCaption: '',
	evidence: '補足・証拠',
	evidenceCaption: '',
	renoteSource: 'リノート元',
	quoteSource: '引用元ノート',
	remainingChars: '{n}',
	totalTooLong: '',
	_category: {
		spam: 'スパム',
		harassment: '嫌がらせ・迷惑行為',
		impersonation: 'なりすまし',
		illegal: '違法・危険なコンテンツ',
		copyright: '著作権侵害',
		doxxing: '個人情報の晒し',
		other: 'その他',
	},
	_commentLabel: {
		category: '【違反カテゴリ】',
		targetUser: '【対象ユーザー】',
		url: '【該当URL】',
		when: '【発生日時】',
		details: '【詳細】',
		evidence: '【補足・証拠】',
		renoteSource: '【リノート元】',
		quoteSource: '【引用元ノート】',
	},
};

const baseValues: AbuseReportFormValues = {
	category: 'spam',
	details: '迷惑行為の詳細',
	when: '2026年9月5日 12:34',
	where: 'https://example.com/notes/abc',
	evidence: '',
};

const baseContext = {
	targetUsername: 'alice',
	where: 'https://example.com/notes/abc',
	when: '2026年9月5日 12:34',
};

describe('abuse-report', () => {
	it('builds structured comment with required fields', () => {
		const comment = buildAbuseReportComment(formLocale, baseValues, baseContext);
		expect(comment).toContain('【違反カテゴリ】スパム');
		expect(comment).toContain('【対象ユーザー】@alice');
		expect(comment).toContain('【詳細】迷惑行為の詳細');
		expect(countRunes(comment)).toBeLessThanOrEqual(ABUSE_REPORT_COMMENT_MAX);
	});

	it('omits empty optional lines', () => {
		const comment = buildAbuseReportComment(formLocale, {
			...baseValues,
			when: '',
			where: '',
			evidence: '',
		}, { targetUsername: 'alice' });
		expect(comment).not.toContain('【該当URL】');
		expect(comment).not.toContain('【発生日時】');
		expect(comment).not.toContain('【補足・証拠】');
	});

	it('appends renote and quote context lines', () => {
		const comment = buildAbuseReportComment(formLocale, baseValues, {
			...baseContext,
			renoteSource: { username: 'bob', url: 'https://example.com/notes/src' },
			quoteSource: { url: 'https://example.com/notes/quote' },
		});
		expect(comment).toContain('【リノート元】@bob / https://example.com/notes/src');
		expect(comment).toContain('【引用元ノート】https://example.com/notes/quote');
	});

	it('rejects invalid form values', () => {
		expect(isAbuseReportFormValid(formLocale, { ...baseValues, category: '' }, baseContext)).toBe(false);
		expect(isAbuseReportFormValid(formLocale, { ...baseValues, details: '' }, baseContext)).toBe(false);
	});

	it('builds note context for quote renote', () => {
		const ctx = buildContextFromNote({
			id: 'n1',
			createdAt: '2026-09-05T03:34:56.000Z',
			text: 'quote text',
			renoteId: 'n0',
			renote: {
				id: 'n0',
				user: { username: 'bob' },
			},
			user: { username: 'alice' },
		} as never, 'https://example.com');
		expect(ctx.where).toBe('https://example.com/notes/n1');
		expect(ctx.quoteSource?.url).toBe('https://example.com/notes/n0');
		expect(ctx.renoteSource).toBeUndefined();
	});
});
