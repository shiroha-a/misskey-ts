/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { inject } from 'vue';
import { page } from '@/router.definition.js';
import { $i } from '@/i.js';
import { Nirax } from '@/lib/nirax.js';
import { ROUTE_DEF } from '@/router.definition.js';
import { analytics } from '@/analytics.js';
import { DI } from '@/di.js';
import { pluginPages, pluginAdminPages } from '@/plugin-api.js';
import type { RouteDef } from '@/lib/nirax.js';

/*
 * サーバープラグインのページを合流させる (mk-go #2477)。
 *
 * ROUTE_DEF は `as const` で型付けされており、Router の型引数にも使われている。
 * プラグインのパスは実行時に決まるので型には現れないが、Nirax は path 文字列で
 * 照合するため動作には影響しない。型安全が効かないのはプラグインのパスだけ。
 */
function routeDefsWithPlugins(): RouteDef[] {
	const defs = [...ROUTE_DEF] as unknown as RouteDef[];

	for (const p of pluginPages()) {
		defs.push({ path: p.fullPath, component: p.component, loginRequired: false });
	}

	const admin = pluginAdminPages();
	if (admin.length > 0) {
		// /admin は children を持つ入れ子ルート。**元の配列を書き換えず**
		// 差し替える (ROUTE_DEF は as const なので共有されている)。
		const i = defs.findIndex(d => 'path' in d && d.path === '/admin');
		if (i >= 0) {
			const base = defs[i] as RouteDef & { children?: RouteDef[] };
			defs[i] = {
				...base,
				children: [
					...(base.children ?? []),
					...admin.map(p => ({ path: p.fullPath, component: p.component })),
				],
			} as RouteDef;
		}
	}
	return defs;
}

export type Router = Nirax<typeof ROUTE_DEF>;

export function createRouter(fullPath: string): Router {
	return new Nirax(
		routeDefsWithPlugins() as unknown as typeof ROUTE_DEF,
		fullPath, !!$i, page(() => import('@/pages/not-found.vue')),
	);
}

export const mainRouter = createRouter(window.location.pathname + window.location.search + window.location.hash);

window.addEventListener('popstate', (event) => {
	mainRouter.replaceByPath(window.location.pathname + window.location.search + window.location.hash);
});

mainRouter.addListener('push', ctx => {
	window.history.pushState({ }, '', ctx.fullPath);
});

mainRouter.addListener('replace', ctx => {
	window.history.replaceState({ }, '', ctx.fullPath);
});

mainRouter.addListener('forceReplace', ctx => {
	window.location.replace(ctx.fullPath);
});

mainRouter.addListener('forcePush', ctx => {
	window.location.href = ctx.fullPath;
});

mainRouter.addListener('change', ctx => {
	if (_DEV_) console.log('mainRouter: change', ctx.fullPath);
	analytics.page({
		path: ctx.fullPath,
		title: ctx.fullPath,
	});
});

mainRouter.init();

export function useRouter(): Router {
	return inject(DI.router, null) ?? mainRouter;
}
