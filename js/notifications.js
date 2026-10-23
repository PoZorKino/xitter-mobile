// The Notifications tab, and the checker that keeps every account's
// notifications (and unread badges) fresh. The work itself is notify-core.js.

import { Page, banner } from "./nav.js";
import { bindPostActions, hydrate, observeVideos, postHtml, spinnerSvg } from "./post.js";
import { formatCents } from "./money.js";
import { prefs } from "./store.js";
import { $, $$, ago, avatar, el, esc, icon, rafThrottle, richText } from "./util.js";

const N = () => self.XNotify;

// ---- the checker

export class NotificationCenter {
	constructor(app) {
		this.app = app;
		this.unread = new Map(); // key -> count
		this.items = new Map(); // key -> items
		this.listeners = new Set();
		this.timers = new Map();
		this.busy = new Set();
		document.addEventListener("visibilitychange", () => {
			if (!document.hidden) this.checkAll();
		});
	}
	on(fn) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}
	emit(key) {
		for (const fn of this.listeners) fn(key);
	}
	async start() {
		for (const a of this.app.accounts()) {
			const s = await N().getState(a.key).catch(() => null);
			if (s) {
				this.items.set(a.key, s.items);
				this.unread.set(a.key, s.items.filter((i) => i.at > s.lastSeen).length);
			}
		}
		this.emit();
		this.checkAll();
		clearInterval(this.loop);
		this.loop = setInterval(() => this.tick(), 15_000);
		this.registerBackground();
	}
	// the active account every 45s, the others every 2 minutes
	tick() {
		if (document.hidden) return;
		const now = Date.now();
		for (const a of this.app.accounts()) {
			const every = a.key === this.app.active?.key ? 45_000 : 120_000;
			if (now - (this.timers.get(a.key) || 0) >= every) this.check(a);
		}
	}
	checkAll() {
		for (const a of this.app.accounts()) this.check(a);
	}
	async check(account) {
		if (this.busy.has(account.key)) return;
		this.busy.add(account.key);
		this.timers.set(account.key, Date.now());
		try {
			const r = await N().check(account);
			if (!r) return;
			this.items.set(account.key, r.items);
			this.unread.set(account.key, r.unread);
			this.emit(account.key);
			if (r.toNotify.length) this.alert(account, r.toNotify);
			N().setBadge();
		} catch (e) {
			if (e.status === 401) this.app.authFailed(account.key);
		} finally {
			this.busy.delete(account.key);
		}
	}
	alert(account, items) {
		const active = account.key === this.app.active?.key;
		const multi = this.app.accounts().length > 1;
		if (!active && !prefs().notifyAll) return;
		if (document.hidden) return N().show(account, items, multi);
		// in the app: a banner, unless you're already looking at that account's notifications
		if (active && this.app.isOnNotifications()) return;
		const first = items[0];
		const d = N().describe(first);
		banner({
			title: multi ? `${d.title} · @${account.user.screen_name}` : d.title,
			body: d.body || (items.length > 1 ? `and ${items.length - 1} more` : ""),
			avatar: first.post?.author.avatar_url || first.users?.[0]?.avatar_url || account.user.avatar_url,
			onTap: () => this.app.openNotification(account.key, first.post?.id, { money: first.kind.startsWith("money") }),
		});
	}
	async markSeen(key) {
		await N().markSeen(key);
		this.unread.set(key, 0);
		this.emit(key);
	}
	totalOthers(activeKey) {
		let n = 0;
		for (const [k, v] of this.unread) if (k !== activeKey) n += v;
		return n;
	}
	async registerBackground() {
		try {
			const reg = await navigator.serviceWorker?.ready;
			if (reg && "periodicSync" in reg) {
				const status = await navigator.permissions.query({ name: "periodic-background-sync" }).catch(() => null);
				if (!status || status.state === "granted") await reg.periodicSync.register("xit-notify", { minInterval: 15 * 60 * 1000 });
			}
		} catch {}
	}
}

// ---- the tab

function itemHtml(item) {
	if (item.kind === "reply" || item.kind === "mention") {
		return postHtml(item.post, { reason: item.kind === "mention" ? `${icon("user")}<span>Mentioned you</span>` : "" });
	}
	const head = (ic, cls) => `<div class="n-icon ${cls}">${icon(ic)}</div>`;
	if (item.kind === "money" || item.kind === "money-request") {
		const p = item.payment, q = item.request, u = p ? p.sender : q.requester;
		const name = `<b>${esc(u.name || u.screen_name)}</b>`;
		const text = p ? `${name} sent you <b>${formatCents(p.amount_cents, { short: true })}</b>` : `${name} asked you for <b>${formatCents(q.amount_cents, { short: true })}</b>`;
		const note = (p || q).note;
		return `<div class="n-item press" data-open-money>${head("money", "money")}<div class="n-body"><div class="n-avs">${avatar(u, "av sm")}</div><div class="n-text">${text} <time>${ago(new Date(item.at).toISOString())}</time></div>${note ? `<div class="n-snippet">${esc(note)}</div>` : ""}</div></div>`;
	}
	if (item.kind === "follow") {
		const users = item.users;
		const who = users[0].name || users[0].screen_name;
		const text = item.total > 1 ? `<b>${esc(who)}</b> and ${item.total - 1} other${item.total > 2 ? "s" : ""} followed you` : `<b>${esc(who)}</b> followed you`;
		return `<div class="n-item press" data-open-user="${esc(users[0].screen_name)}">${head("user", "follow")}<div class="n-body"><div class="n-avs">${users.slice(0, 7).map((u) => `<span data-open-user="${esc(u.screen_name)}">${avatar(u, "av sm")}</span>`).join("")}</div><div class="n-text">${text} <time>${ago(new Date(item.at).toISOString())}</time></div></div></div>`;
	}
	const like = item.kind === "like";
	const text = like ? `Your post got <b>${item.n}</b> new like${item.n > 1 ? "s" : ""}` : `Your post was reposted <b>${item.n}</b> time${item.n > 1 ? "s" : ""}`;
	return `<div class="n-item press" data-open-post="${esc(item.post.id)}">${head(like ? "heart-f" : "repost", like ? "like" : "repost")}<div class="n-body"><div class="n-avs">${avatar(item.post.author, "av sm")}</div><div class="n-text">${text} <time>${ago(new Date(item.at).toISOString())}</time></div>${item.post.text ? `<div class="n-snippet">${richText(item.post.text)}</div>` : ""}</div></div>`;
}

export class NotificationsPage extends Page {
	constructor(ctx) {
		super(ctx);
		this.tab = "all";
		this.el = el(`<section class="page notif-page">
			<header class="bar"><div class="bar-row"><button class="bar-avatar press" data-drawer>${avatar(ctx.account.user)}</button><div class="bar-title"><b>Notifications</b></div><div class="bar-right"><button class="bar-btn press" data-settings>${icon("gear")}</button></div></div>
			<div class="seg"><button class="on" data-t="all">All</button><button data-t="mentions">Mentions</button></div></header>
			<div class="scroll"><div class="perm-slot"></div><div class="list"><div class="loading">${spinnerSvg}</div></div></div></section>`);
		this.el.querySelector("[data-drawer]").onclick = () => ctx.drawer();
		this.el.querySelector("[data-settings]").onclick = () => ctx.open("settings");
		bindPostActions(this.el, ctx);
		this.el.addEventListener("click", (e) => {
			const u = e.target.closest("[data-open-user]");
			if (u) return ctx.open("profile", { name: u.dataset.openUser });
			if (e.target.closest("[data-open-money]")) return ctx.open("money");
			const p = e.target.closest("[data-open-post]");
			if (p) return ctx.open("post", { id: p.dataset.openPost });
			const b = e.target.closest(".seg button");
			if (b) {
				this.tab = b.dataset.t;
				$$(".seg button", this.el).forEach((x) => x.classList.toggle("on", x === b));
				this.render();
			}
			if (e.target.closest("[data-perm]")) ctx.app.requestNotifications().then(() => this.renderPerm());
			if (e.target.closest("[data-perm-x]")) {
				try {
					localStorage.setItem("xit.permDismissed", "1");
				} catch {}
				this.renderPerm();
			}
		});
		this.off = ctx.app.notifications.on((key) => {
			if (!key || key === ctx.account.key) this.render();
		});
		this.attachPull();
		this.render();
		this.renderPerm();
	}
	renderPerm() {
		const slot = $(".perm-slot", this.el);
		let dismissed = false;
		try {
			dismissed = !!localStorage.getItem("xit.permDismissed");
		} catch {}
		const perm = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
		if (perm !== "default" || dismissed) return void (slot.innerHTML = "");
		slot.innerHTML = `<div class="perm-card"><button class="perm-x" data-perm-x>${icon("close")}</button><b>Turn on notifications</b><p>Get alerts for replies, mentions, new followers, likes and reposts — on every account you've added.</p><button class="pill-btn solid" data-perm>Turn on</button></div>`;
	}
	render() {
		const items = (this.ctx.app.notifications.items.get(this.ctx.account.key) || []).filter((i) => this.tab === "all" || i.kind === "reply" || i.kind === "mention");
		const list = $(".list", this.el);
		if (!this.ctx.app.notifications.items.has(this.ctx.account.key)) return;
		list.innerHTML = items.length
			? items.map(itemHtml).join("")
			: `<div class="empty"><b>${this.tab === "all" ? "Nothing to see here — yet" : "No mentions yet"}</b><p>${this.tab === "all" ? "Likes, reposts, replies, new followers and more will show up here." : "When someone mentions you or replies to you, you'll find it here."}</p></div>`;
		for (const i of items) if (i.post) this.ctx.api.remember(i.post);
		hydrate(list, this.ctx.api);
		observeVideos(list);
	}
	attachPull() {
		// simple pull: refresh when released past the top
		const s = this.scroller;
		let armed = false;
		s.addEventListener("scroll", rafThrottle(() => {
			if (-s.scrollTop > 70) armed = true;
		}), { passive: true });
		s.addEventListener("touchend", () => {
			if (armed) {
				armed = false;
				this.ctx.app.notifications.check(this.ctx.account);
			}
		});
	}
	show() {
		this.ctx.app.notifications.check(this.ctx.account);
		this.ctx.app.notifications.markSeen(this.ctx.account.key);
	}
	hide() {
		this.ctx.app.notifications.markSeen(this.ctx.account.key);
	}
	destroy() {
		this.off?.();
	}
}
