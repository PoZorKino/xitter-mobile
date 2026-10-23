// The screens: home, a post, a profile, search, follower lists and settings.

import { ApiError } from "./api.js";
import { Page, actionSheet, toast } from "./nav.js";
import { Feed, bindPostActions, explainBadge, focusHtml, hydrate, observeVideos, postHtml, spinnerSvg } from "./post.js";
import { cacheGet, cacheSet, prefs, setPref } from "./store.js";
import { $, $$, avatar, count, debounce, el, esc, haptic, icon, isRemote, joined, rafThrottle, profileLabel, richText, verifiedBadge } from "./util.js";

const backBtn = `<button class="bar-btn back press" data-back aria-label="Back">${icon("back")}</button>`;

function bar({ left = backBtn, title = "", sub = "", right = "" } = {}) {
	return `<header class="bar"><div class="bar-row">${left}<div class="bar-title"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</div><div class="bar-right">${right}</div></div></header>`;
}

function wireBack(page) {
	page.el.addEventListener("click", (e) => {
		if (e.target.closest("[data-back]")) page.ctx.back();
	});
}

// hide the bar while scrolling down, bring it back on the way up (X does this)
function autoHideBar(page, scroller, target) {
	let last = 0;
	scroller.addEventListener("scroll", rafThrottle(() => {
		const y = scroller.scrollTop;
		const d = y - last;
		if (y < 60 || d < -6) target.classList.remove("bar-hidden");
		else if (d > 6) target.classList.add("bar-hidden");
		last = y;
	}), { passive: true });
}

export function userCell(u, { me } = {}) {
	const mine = me && u.screen_name.toLowerCase() === me.toLowerCase();
	const following = u.viewer?.following;
	return `<div class="user-cell press" data-user="${esc(u.screen_name)}">
		${avatar(u)}
		<div class="user-cell-body">
			<div class="user-cell-head"><div class="user-cell-names"><div class="name-row"><span class="name">${esc(u.name || u.screen_name)}</span>${verifiedBadge(u)}${u.protected ? icon("lock", "lock") : ""}${isRemote(u) ? icon("globe", "globe") : ""}</div><span class="handle">@${esc(u.screen_name)}${u.viewer?.followed_by ? ` <em class="follows-you">Follows you</em>` : ""}</span>${profileLabel(u)}</div>
			${mine || !u.viewer ? "" : `<button class="pill-btn ${following ? "outline" : "solid"}" data-follow>${following ? "Following" : "Follow"}</button>`}</div>
			${u.bio ? `<div class="user-cell-bio">${richText(u.bio)}</div>` : ""}
		</div>
	</div>`;
}

export function bindUserCells(root, ctx) {
	root.addEventListener("click", async (e) => {
		const cell = e.target.closest(".user-cell");
		if (!cell) return;
		if (e.target.closest("a.lnk[href]")) return;
		const name = cell.dataset.user;
		const btn = e.target.closest("[data-follow]");
		if (!btn) return ctx.open("profile", { name });
		e.stopPropagation();
		const on = !btn.classList.contains("outline");
		if (!on) {
			const ok = await actionSheet([{ label: `Unfollow @${name}`, danger: true, value: true }]);
			if (!ok) return;
		}
		haptic(8);
		setFollowBtn(btn, on);
		try {
			const u = await ctx.api.follow(name, on);
			if (on && !u.viewer?.following) {
				setFollowBtn(btn, false, "Pending");
				toast("Follow request sent");
			}
		} catch (err) {
			setFollowBtn(btn, !on);
			toast(err.message, { error: true });
		}
	});
}
function setFollowBtn(btn, following, label) {
	btn.classList.toggle("outline", following || !!label);
	btn.classList.toggle("solid", !following && !label);
	btn.textContent = label || (following ? "Following" : "Follow");
}

// ---- Home: Following, Latest and Popular, side by side; swipe between them

const HOME_TABS = [
	{ key: "following", label: "Following" },
	{ key: "latest", label: "Latest" },
	{ key: "popular", label: "Popular" },
];
const weekAgo = () => new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

export class HomePage extends Page {
	constructor(ctx) {
		super(ctx);
		const a = ctx.account;
		this.state = cacheGet(a.key, "home-state") || {};
		this.tab = HOME_TABS.some((t) => t.key === this.state.tab) ? this.state.tab : "following";
		this.el = el(`<section class="page home">
			<header class="bar home-bar"><div class="bar-row">
				<button class="bar-avatar press" data-drawer aria-label="Accounts">${avatar(a.user)}<span class="badge-dot" hidden></span></button>
				<div class="bar-logo">${icon("logo")}</div>
				<div class="bar-right"></div>
			</div>
			<nav class="home-tabs" role="tablist">${HOME_TABS.map((t) => `<button role="tab" data-tab="${t.key}">${t.label}</button>`).join("")}<i class="tab-ink"></i></nav></header>
			<div class="pager">${HOME_TABS.map((t) => `<div class="pane" data-pane="${t.key}"><div class="scroll"><div class="list"></div></div></div>`).join("")}</div>
			<button class="new-pill" hidden><span class="new-avs"></span>${icon("back")}<span>Posted</span></button>
		</section>`);
		this.pager = $(".pager", this.el);
		this.ink = $(".tab-ink", this.el);
		this.feeds = {};
		bindPostActions(this.el, ctx);
		this.el.querySelector("[data-drawer]").onclick = () => ctx.drawer();
		this.pill = $(".new-pill", this.el);
		this.pill.onclick = () => this.showPending();
		this.pending = [];
		for (const pane of $$(".pane", this.el)) autoHideBar(this, $(".scroll", pane), ctx.chrome);

		this.el.querySelector(".home-tabs").addEventListener("click", (e) => {
			const b = e.target.closest("[data-tab]");
			if (!b) return;
			if (b.dataset.tab === this.tab) return this.scrollTop();
			this.select(b.dataset.tab, { animate: true });
		});
		this.el.addEventListener("click", (e) => {
			const go = e.target.closest("[data-go-tab]");
			if (go) this.select(go.dataset.goTab, { animate: true });
			if (e.target.closest("[data-go-search]")) ctx.app.current.selectTab("search"), ctx.app.updateChrome();
		});
		// the ink follows your finger; settling on a pane selects its tab
		let settle;
		this.pager.addEventListener("scroll", rafThrottle(() => {
			const w = this.pager.clientWidth;
			if (!w) return;
			const x = this.pager.scrollLeft / w;
			this.moveInk(x);
			clearTimeout(settle);
			settle = setTimeout(() => {
				const t = HOME_TABS[Math.round(this.pager.scrollLeft / this.pager.clientWidth)]?.key;
				if (t && t !== this.tab) this.select(t);
			}, 90);
		}), { passive: true });
		addEventListener("resize", () => this.select(this.tab));

		this.select(this.tab);
		// tabs can only be measured (and the pager scrolled) once on screen
		requestAnimationFrame(() => this.select(this.tab));
		// load the other tabs in the background, so a swipe never lands on a spinner
		this.preload = setTimeout(() => HOME_TABS.forEach((t) => this.feeds[t.key] || this.makeFeed(t.key)), 1500);
		this.poll = setInterval(() => this.checkNew(), 45_000);
		// leaving the app is when your place matters most
		this.onHidden = (e) => (e.type === "pagehide" || document.hidden) && this.saveState();
		document.addEventListener("visibilitychange", this.onHidden);
		addEventListener("pagehide", this.onHidden);
	}

	get scroller() {
		return $(`[data-pane="${this.tab}"] .scroll`, this.el);
	}

	moveInk(x) {
		const tabs = $$(".home-tabs button", this.el);
		const i = Math.max(0, Math.min(tabs.length - 1, x));
		const lo = tabs[Math.floor(i)], hi = tabs[Math.ceil(i)], f = i - Math.floor(i);
		const left = lo.offsetLeft + (hi.offsetLeft - lo.offsetLeft) * f, width = lo.offsetWidth + (hi.offsetWidth - lo.offsetWidth) * f;
		this.ink.style.transform = `translateX(${left + width / 2 - 28}px)`;
		tabs.forEach((t, j) => t.classList.toggle("on", j === Math.round(i)));
	}

	select(tab, { animate = false } = {}) {
		const i = HOME_TABS.findIndex((t) => t.key === tab);
		const changed = tab !== this.tab;
		this.tab = tab;
		const left = i * this.pager.clientWidth;
		if (Math.abs(this.pager.scrollLeft - left) > 1) this.pager.scrollTo({ left, behavior: animate ? "smooth" : "instant" });
		this.moveInk(i);
		if (!this.feeds[tab]) this.makeFeed(tab);
		this.ctx.chrome.classList.remove("bar-hidden");
		if (changed) {
			this.saveState();
			if (tab !== "following") this.pill.hidden = true;
			else if (this.pending.length) this.pill.hidden = false;
		}
	}

	makeFeed(tab) {
		const { ctx } = this, a = ctx.account;
		const pane = $(`[data-pane="${tab}"]`, this.el);
		const scroller = $(".scroll", pane);
		const load = {
			following: (cursor) => ctx.api.timeline({ cursor }),
			latest: (cursor) => ctx.api.searchPosts(`since:${weekAgo()}`, { cursor }),
			popular: (cursor) => ctx.api.searchPosts(`since:${weekAgo()}`, { sort: "top", cursor }),
		}[tab];
		const empty = {
			following: `<b>Welcome to ${esc(a.instance)}</b><p>Posts from people you follow show up here.</p><div class="empty-actions"><button class="pill-btn solid" data-go-tab="latest">See what's new</button><button class="pill-btn outline" data-go-search>Find people</button></div>`,
			latest: `<b>Quiet this week</b><p>Nothing's been posted on ${esc(a.instance)} or the instances it federates with lately.</p>`,
			popular: `<b>Nothing popular yet</b><p>The most liked posts of the week show up here.</p>`,
		}[tab];
		const feed = new Feed({ ctx, scroller, list: $(".list", pane), load, empty, cached: cacheGet(a.key, `home-${tab}`), onRefresh: () => this.snapshot(tab) });
		this.feeds[tab] = feed;
		// back where you were reading, then fresh posts slide in above
		if (feed.stale) {
			if (this.state.anchors?.[tab]) requestAnimationFrame(() => feed.restore(this.state.anchors[tab]));
			feed.refresh();
		} else feed.more().then(() => this.snapshot(tab));
		scroller.addEventListener("scroll", rafThrottle(() => {
			if (tab === "following" && scroller.scrollTop < 30 && this.pending.length) this.showPending(false);
			clearTimeout(this.saveTimer);
			this.saveTimer = setTimeout(() => this.saveState(), 400);
		}), { passive: true });
	}

	snapshot(tab) {
		const f = this.feeds[tab];
		if (f?.items.length) cacheSet(this.ctx.account.key, `home-${tab}`, { data: f.items.slice(0, 40), next_cursor: f.items.length > 40 ? f.items[39].id : f.cursor });
	}
	saveState() {
		const anchors = { ...this.state.anchors };
		for (const [t, f] of Object.entries(this.feeds)) {
			const at = f.anchor();
			// only places inside the snapshot can be restored
			if (at && f.items.slice(0, 40).some((p) => p.id === at.pid)) anchors[t] = at;
			else delete anchors[t];
		}
		this.state = { tab: this.tab, anchors };
		cacheSet(this.ctx.account.key, "home-state", this.state);
	}

	async checkNew() {
		const feed = this.feeds.following;
		if (!feed || document.hidden || !feed.items.length || !this.el.isConnected || this.el.classList.contains("covered")) return;
		try {
			const out = await this.ctx.api.timeline({ limit: 20 });
			const fresh = out.data.filter((p) => !feed.keys.has(feed.keyOf(p)) && !this.pending.some((q) => q.id === p.id));
			if (!fresh.length) return;
			const scroller = $(`[data-pane="following"] .scroll`, this.el);
			if (scroller.scrollTop < 30) {
				feed.append(fresh, { prepend: true }).forEach((_, i) => feed.list.children[i]?.classList.add("arrive"));
				this.snapshot("following");
				return;
			}
			this.pending = [...fresh, ...this.pending];
			const avs = [...new Map(this.pending.map((p) => [p.author.screen_name, p.author])).values()].slice(0, 3);
			$(".new-avs", this.pill).innerHTML = avs.map((u) => avatar(u, "av xs")).join("");
			if (this.pill.hidden && this.tab === "following") {
				this.pill.hidden = false;
				this.pill.animate([{ transform: "translate3d(-50%,-30px,0) scale(.8)", opacity: 0 }, { transform: "translate3d(-50%,0,0) scale(1)", opacity: 1 }], { duration: 380, easing: "cubic-bezier(0.32,0.72,0,1)" });
			}
		} catch {}
	}
	showPending(scroll = true) {
		const posts = this.pending;
		const feed = this.feeds.following;
		const scroller = $(`[data-pane="following"] .scroll`, this.el);
		this.pending = [];
		this.pill.hidden = true;
		if (scroll) scroller.scrollTo({ top: 0 });
		if (posts.length) feed.append(posts, { prepend: true });
		if (scroll) requestAnimationFrame(() => scroller.scrollTo({ top: 0, behavior: "smooth" }));
	}
	show() {
		this.checkNew();
	}
	hide() {
		this.saveState();
	}
	destroy() {
		clearInterval(this.poll);
		clearTimeout(this.preload);
		document.removeEventListener("visibilitychange", this.onHidden);
		removeEventListener("pagehide", this.onHidden);
		Object.values(this.feeds).forEach((f) => f.destroy());
	}
}

// ---- Explore: what's new across the instance and its federation

export class ExplorePage extends Page {
	constructor(ctx) {
		super(ctx);
		this.el = el(`<section class="page">${bar({ title: "Explore", sub: esc(ctx.account.instance) })}
			<div class="seg sticky-seg"><button class="on" data-mode="latest">Latest</button><button data-mode="top">Popular this week</button></div>
			<div class="scroll"><div class="list"></div></div></section>`);
		wireBack(this);
		bindPostActions(this.el, ctx);
		const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
		const mk = (mode) => {
			$(".list", this.el).innerHTML = "";
			$$(".sentinel, .ptr", this.el).forEach((n) => n.remove());
			this.feed?.destroy();
			this.feed = new Feed({
				ctx, scroller: this.scroller, list: $(".list", this.el),
				load: (cursor) => ctx.api.searchPosts(`since:${since}`, { sort: mode === "top" ? "top" : undefined, cursor }),
				empty: "Nothing posted this week.",
			});
			this.feed.more();
		};
		this.el.querySelector(".seg").addEventListener("click", (e) => {
			const b = e.target.closest("button");
			if (!b || b.classList.contains("on")) return;
			$$(".seg button", this.el).forEach((x) => x.classList.toggle("on", x === b));
			mk(b.dataset.mode);
		});
		mk("latest");
	}
	destroy() {
		this.feed?.destroy();
	}
}

// ---- A post and its conversation

export class PostPage extends Page {
	constructor(ctx, { id, post }) {
		super(ctx);
		this.id = id;
		this.el = el(`<section class="page post-page">${bar({ title: "Post" })}
			<div class="scroll"><div class="parents"></div><div class="focus-wrap"></div><div class="replies"><div class="loading">${spinnerSvg}</div></div><div class="tail"></div></div>
			<button class="reply-bar press" data-reply>${avatar(ctx.account.user, "av xs")}<span>Post your reply</span></button></section>`);
		wireBack(this);
		bindPostActions(this.el, ctx);
		this.el.querySelector("[data-reply]").onclick = () => {
			const p = ctx.api.posts.get(this.id);
			if (p) ctx.compose({ replyTo: p });
		};
		const first = post || ctx.api.posts.get(id);
		if (first) this.renderFocus(first);
		this.load(!first);
	}
	renderFocus(p) {
		const wrap = $(".focus-wrap", this.el);
		wrap.innerHTML = focusHtml(p);
		hydrate(wrap, this.ctx.api);
		observeVideos(wrap);
	}
	async load(needFocus) {
		const api = this.ctx.api;
		try {
			const p = await api.post(this.id, { fresh: true });
			if (needFocus || !$(".focus-wrap .post", this.el)) this.renderFocus(p);
			else api.publish(p);
			const [replies] = await Promise.all([api.replies(this.id).catch(() => []), this.loadParents(p)]);
			const box = $(".replies", this.el);
			// your own replies first, then by engagement, as X does
			const me = this.ctx.account.user.screen_name.toLowerCase();
			replies.sort((a, b) => (b.author.screen_name.toLowerCase() === me) - (a.author.screen_name.toLowerCase() === me) || (b.counts.likes + b.counts.replies) - (a.counts.likes + a.counts.replies));
			box.innerHTML = replies.length ? replies.map((r) => postHtml(r)).join("") : "";
			hydrate(box, api);
			observeVideos(box);
		} catch (e) {
			$(".replies", this.el).innerHTML = `<div class="empty">${esc(e.message)}</div>`;
		}
	}
	async loadParents(p) {
		const api = this.ctx.api;
		const chain = [];
		let cur = p;
		while (cur.reply_to && chain.length < 12) {
			try {
				cur = await api.post(cur.reply_to);
				chain.unshift(cur);
			} catch {
				chain.unshift(null);
				break;
			}
		}
		if (!chain.length) return;
		const box = $(".parents", this.el);
		const s = this.scroller;
		const before = s.scrollHeight, top = s.scrollTop;
		box.innerHTML = chain.map((x, i) => (x ? postHtml(x, { threadUp: i > 0, threadDown: true }) : `<div class="post unavailable-post">This post is unavailable.</div>`)).join("");
		$(".focus-wrap .post", this.el)?.classList.add("t-up");
		hydrate(box, api);
		// keep the focused post where it was, so the thread opens above it
		$(".tail", this.el).style.minHeight = `calc(100vh - 200px)`;
		s.scrollTop = top + (s.scrollHeight - before);
	}
}

// ---- Profile

export class ProfilePage extends Page {
	constructor(ctx, { name, user }) {
		super(ctx);
		this.name = name;
		const isTabRoot = !!ctx.isTabRoot;
		this.el = el(`<section class="page profile">
			<header class="bar profile-bar"><div class="bar-row">${isTabRoot ? `<span></span>` : `<button class="bar-btn back circle press" data-back aria-label="Back">${icon("back")}</button>`}
				<div class="bar-title"><b class="pb-name"></b><span class="pb-sub"></span></div><div class="bar-right">${isTabRoot ? `<button class="bar-btn circle press" data-settings aria-label="Settings">${icon("gear")}</button>` : `<button class="bar-btn circle press" data-more aria-label="More">${icon("more")}</button>`}</div></div></header>
			<div class="scroll">
				<div class="banner-wrap"><div class="banner"></div></div>
				<div class="profile-head"><div class="profile-skeleton">${spinnerSvg}</div></div>
				<div class="seg profile-tabs"><button class="on" data-tab="posts">Posts</button><button data-tab="replies">Replies</button><button data-tab="media">Media</button></div>
				<div class="tab-panels"><div class="panel" data-panel="posts"><div class="list"></div></div><div class="panel" data-panel="replies" hidden><div class="list"></div></div><div class="panel" data-panel="media" hidden><div class="list"></div></div></div>
			</div></section>`);
		wireBack(this);
		bindPostActions(this.el, ctx);
		bindUserCells(this.el, ctx);
		this.el.querySelector("[data-settings]")?.addEventListener("click", () => ctx.open("settings"));
		this.el.querySelector("[data-more]")?.addEventListener("click", () => this.more());
		// once: the header is redrawn, its listener isn't
		$(".profile-head", this.el).addEventListener("click", (e) => {
			// handled here only: the page's post handler would open them a second time
			const l = e.target.closest("[data-user].lnk"), t = e.target.closest("[data-tag]"), v = e.target.closest("[data-verified]");
			if (l || t || v) e.stopPropagation();
			if (v) return explainBadge(this.user, this.ctx);
			if (l) return this.ctx.open("profile", { name: l.dataset.user });
			if (t) this.ctx.open("search", { q: "#" + t.dataset.tag });
		});
		const cached = user || ctx.api.cachedUser(name);
		if (cached) this.renderHead(cached);
		this.loadUser();
		this.feeds = {};
		this.makeFeed("posts");
		this.feeds.posts.more();
		this.el.querySelector(".profile-tabs").addEventListener("click", (e) => {
			const b = e.target.closest("[data-tab]");
			if (!b) return;
			const tab = b.dataset.tab;
			$$(".profile-tabs button", this.el).forEach((x) => x.classList.toggle("on", x === b));
			$$(".panel", this.el).forEach((p) => (p.hidden = p.dataset.panel !== tab));
			if (!this.feeds[tab]) {
				this.makeFeed(tab);
				this.feeds[tab].more();
			}
			const head = $(".profile-tabs", this.el);
			if (this.scroller.scrollTop > head.offsetTop - 56) this.scroller.scrollTop = head.offsetTop - 56;
		});
		// stretchy banner, the avatar shrinking under it, and the bar title fading in
		const s = this.scroller;
		const wrap = $(".banner-wrap", this.el), banner = $(".banner", this.el), barEl = $(".profile-bar", this.el);
		const STICK = 104 - 53; // banner height minus the bar row: where it pins
		s.addEventListener("scroll", rafThrottle(() => {
			const y = s.scrollTop;
			const H = wrap.offsetHeight;
			banner.style.transform = y < 0 ? `scale(${(H - y) / H})` : "";
			banner.style.filter = y > STICK ? `blur(${Math.min(10, (y - STICK) / 6)}px) brightness(${1 - Math.min(0.35, (y - STICK) / 160)})` : "";
			wrap.classList.toggle("stuck", y >= STICK);
			const av = $(".profile-top .av.big", this.el);
			if (av) av.style.transform = y > 0 ? `scale(${Math.max(0.62, 1 - (y / STICK) * 0.38)})` : "";
			barEl.classList.toggle("titled", y > 190);
		}), { passive: true });
	}
	makeFeed(tab) {
		const { ctx } = this;
		const panel = $(`[data-panel="${tab}"]`, this.el);
		const n = this.name;
		this.feeds[tab] = new Feed({
			ctx,
			scroller: this.scroller,
			list: $(".list", panel),
			pull: tab === "posts",
			load:
				tab === "media"
					? (cursor) => ctx.api.searchPosts(`from:${n} filter:media`, { cursor })
					: (cursor) => ctx.api.userPosts(n, { cursor, replies: tab === "replies" }),
			empty: tab === "media" ? "No photos or videos yet." : "No posts yet.",
			onRefresh: () => this.loadUser(),
		});
	}
	async loadUser() {
		try {
			const u = await this.ctx.api.user(this.name);
			this.renderHead(u);
		} catch (e) {
			if (!this.user) {
				$(".profile-head", this.el).innerHTML = `<div class="empty"><b>${e instanceof ApiError && e.status === 404 ? "This account doesn't exist" : "Couldn't load this account"}</b><p>${esc(e.message)}</p></div>`;
				$(".profile-tabs", this.el).hidden = true;
			}
		}
	}
	renderHead(u) {
		this.user = u;
		const me = this.ctx.account.user.screen_name.toLowerCase() === u.screen_name.toLowerCase();
		const remote = isRemote(u);
		const [local, home] = u.screen_name.split("@");
		$(".banner", this.el).style.backgroundImage = u.banner_url ? `url("${u.banner_url.replace(/"/g, "%22")}")` : "";
		$(".pb-name", this.el).innerHTML = `${esc(u.name || u.screen_name)}${verifiedBadge(u)}`;
		$(".pb-sub", this.el).textContent = u.counts ? `${count(u.counts.posts)} posts` : "";
		const following = u.viewer?.following;
		const site = u.website ? u.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : "";
		$(".profile-head", this.el).innerHTML = `
			<div class="profile-top">${avatar(u, "av big")}<div class="profile-buttons">
				${me ? `<button class="pill-btn outline" data-edit>Edit profile</button>` : u.viewer ? `<button class="pill-btn ${following ? "outline" : "solid"}" data-follow-main>${following ? "Following" : "Follow"}</button>` : ""}
			</div></div>
			<div class="profile-names"><h1>${esc(u.name || u.screen_name)}${verifiedBadge(u, { max: 8 })}${u.protected ? icon("lock", "lock") : ""}</h1>
				<div class="handle">@${esc(local)}${remote ? `<span class="instance-chip">${icon("globe")}${esc(home)}</span>` : ""}${u.viewer?.followed_by ? ` <em class="follows-you">Follows you</em>` : ""}</div>${profileLabel(u)}</div>
			${u.affiliations?.length ? `<div class="profile-affiliations">${u.affiliations.map((o) => `<button class="aff-chip press" data-org="${esc(o.screen_name)}"><img class="aff" src="${esc(o.badge_url || "")}" alt="">${esc(o.name)}</button>`).join("")}</div>` : ""}
			${u.bio ? `<div class="profile-bio">${richText(u.bio)}</div>` : ""}
			<div class="profile-meta">
				${u.location ? `<span>${icon("pin")}${esc(u.location)}</span>` : ""}
				${site ? `<span>${icon("link")}<a class="lnk" href="${esc(u.website)}" target="_blank" rel="noopener">${esc(site)}</a></span>` : ""}
				${u.created_at ? `<span>${icon("cal")}${joined(u.created_at)}</span>` : ""}
			</div>
			${u.counts ? `<div class="profile-counts"><button data-list="following"><b>${count(u.counts.following)}</b> Following</button><button data-list="followers"><b>${count(u.counts.followers)}</b> Followers</button>${u.affiliates_count ? `<span><b>${count(u.affiliates_count)}</b> Affiliates</span>` : ""}</div>` : ""}`;
		const head = $(".profile-head", this.el);
		head.querySelectorAll("[data-list]").forEach((b) => (b.onclick = () => this.ctx.open("follows", { name: u.screen_name, which: b.dataset.list })));
		head.querySelectorAll(".aff-chip").forEach((b) => (b.onclick = () => this.ctx.open("profile", { name: b.dataset.org })));
		head.querySelector("[data-edit]")?.addEventListener("click", () => window.open(`${this.ctx.api.origin}/settings/profile`, "_blank", "noopener"));
		head.querySelector("[data-follow-main]")?.addEventListener("click", (e) => this.toggleFollow(e.currentTarget));
		head.querySelector(".av.big")?.addEventListener("click", () => this.ctx.viewImage(u.avatar_url));
	}
	async toggleFollow(btn) {
		const u = this.user;
		const on = !btn.classList.contains("outline");
		if (!on && !(await actionSheet([{ label: `Unfollow @${u.screen_name}`, danger: true, value: true }]))) return;
		haptic(10);
		setFollowBtn(btn, on);
		try {
			const fresh = await this.ctx.api.follow(u.screen_name, on);
			this.renderHead(fresh);
			if (on && !fresh.viewer?.following) {
				setFollowBtn($("[data-follow-main]", this.el), false, "Pending");
				toast("Follow request sent");
			}
		} catch (err) {
			setFollowBtn(btn, !on);
			toast(err.message, { error: true });
		}
	}
	async more() {
		const u = this.user;
		if (!u) return;
		const c = await actionSheet([
			{ label: "Copy link to profile", icon: "link", value: "copy" },
			{ label: "Open in browser", icon: "globe", value: "web" },
			{ label: `Search posts from @${u.screen_name}`, icon: "search", value: "search" },
		]);
		if (c === "copy") navigator.clipboard?.writeText(u.url).then(() => toast("Copied to clipboard"));
		if (c === "web") window.open(u.url, "_blank", "noopener");
		if (c === "search") this.ctx.open("search", { q: `from:${u.screen_name}` });
	}
	destroy() {
		Object.values(this.feeds).forEach((f) => f.destroy());
	}
}

// ---- Followers / following

export class FollowsPage extends Page {
	constructor(ctx, { name, which }) {
		super(ctx);
		this.el = el(`<section class="page">${bar({ title: which === "followers" ? "Followers" : "Following", sub: "@" + esc(name) })}
			<div class="seg sticky-seg"><button data-w="followers" class="${which === "followers" ? "on" : ""}">Followers</button><button data-w="following" class="${which === "following" ? "on" : ""}">Following</button></div>
			<div class="scroll"><div class="list"><div class="loading">${spinnerSvg}</div></div></div></section>`);
		wireBack(this);
		bindUserCells(this.el, ctx);
		const load = async (w) => {
			const list = $(".list", this.el);
			list.innerHTML = `<div class="loading">${spinnerSvg}</div>`;
			$(".bar-title b", this.el).textContent = w === "followers" ? "Followers" : "Following";
			try {
				const users = await ctx.api.follows(name, w, 200);
				list.innerHTML = users.length ? users.map((u) => userCell(u, { me: ctx.account.user.screen_name })).join("") : `<div class="empty">${w === "followers" ? "No followers yet." : "Not following anyone yet."}</div>`;
			} catch (e) {
				list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
			}
		};
		this.el.querySelector(".seg").addEventListener("click", (e) => {
			const b = e.target.closest("button");
			if (!b) return;
			$$(".seg button", this.el).forEach((x) => x.classList.toggle("on", x === b));
			load(b.dataset.w);
		});
		load(which);
	}
}

// ---- Search (tab root) and results

const RECENT = (key) => `xit.recent.${key}`;
const recent = (key) => {
	try {
		return JSON.parse(localStorage.getItem(RECENT(key)) || "[]");
	} catch {
		return [];
	}
};
const addRecent = (key, q) => {
	try {
		localStorage.setItem(RECENT(key), JSON.stringify([q, ...recent(key).filter((x) => x !== q)].slice(0, 12)));
	} catch {}
};

export class SearchPage extends Page {
	constructor(ctx) {
		super(ctx);
		this.el = el(`<section class="page search-page">
			<header class="bar"><div class="bar-row search-row">
				<button class="bar-avatar press" data-drawer>${avatar(ctx.account.user)}</button>
				<form class="search-box">${icon("search")}<input type="search" enterkeyhint="search" placeholder="Search ${esc(ctx.account.instance)}" autocomplete="off" autocapitalize="off"><button type="button" class="clear" hidden>${icon("close")}</button></form>
			</div></header>
			<div class="scroll"><div class="typeahead"></div><div class="search-home"></div></div></section>`);
		const input = $("input", this.el);
		const form = $("form", this.el);
		const clear = $(".clear", this.el);
		this.el.querySelector("[data-drawer]").onclick = () => ctx.drawer();
		bindUserCells(this.el, ctx);
		form.onsubmit = (e) => {
			e.preventDefault();
			const q = input.value.trim();
			if (!q) return;
			input.blur();
			this.go(q);
		};
		clear.onclick = () => {
			input.value = "";
			clear.hidden = true;
			$(".typeahead", this.el).innerHTML = "";
			this.renderHome();
			input.focus();
		};
		const type = debounce(async () => {
			const q = input.value.trim();
			const box = $(".typeahead", this.el);
			if (q.length < 1) return void (box.innerHTML = "");
			try {
				const users = await ctx.api.searchUsers(q.replace(/^@/, ""), 6);
				if (input.value.trim() !== q) return;
				box.innerHTML = `<button class="search-for press" data-q="${esc(q)}">${icon("search")}Search for “${esc(q)}”</button>` + users.map((u) => userCell(u, { me: ctx.account.user.screen_name })).join("");
			} catch {}
		}, 180);
		input.addEventListener("input", () => {
			clear.hidden = !input.value;
			$(".search-home", this.el).hidden = !!input.value;
			type();
		});
		this.el.addEventListener("click", (e) => {
			const r = e.target.closest("[data-q]");
			if (r) this.go(r.dataset.q);
			const x = e.target.closest("[data-forget]");
			if (x) {
				e.stopPropagation();
				try {
					localStorage.removeItem(RECENT(ctx.account.key));
				} catch {}
				this.renderHome();
			}
			const ex = e.target.closest("[data-explore]");
			if (ex) ctx.open("explore");
		});
		this.renderHome();
	}
	go(q) {
		addRecent(this.ctx.account.key, q);
		this.ctx.open("search", { q });
		setTimeout(() => this.renderHome(), 500);
	}
	renderHome() {
		const items = recent(this.ctx.account.key);
		$(".search-home", this.el).hidden = false;
		$(".search-home", this.el).innerHTML = `
			<button class="explore-card press" data-explore><div><b>Explore ${esc(this.ctx.account.instance)}</b><span>Latest and popular posts across the federation</span></div>${icon("back", "flip")}</button>
			${items.length ? `<div class="section-head"><b>Recent</b><button data-forget>Clear all</button></div>${items.map((q) => `<button class="recent press" data-q="${esc(q)}">${icon("search")}<span>${esc(q)}</span></button>`).join("")}` : ""}
			<div class="tips"><b>Search tips</b><p><code>from:name</code> · <code>to:name</code> · <code>@name@instance</code> · <code>#tag</code> · <code>filter:media</code> · <code>min_faves:10</code> · <code>since:2026-01-01</code></p></div>`;
	}
	scrollTop() {
		super.scrollTop();
		$("input", this.el).focus();
	}
}

export class SearchResultsPage extends Page {
	constructor(ctx, { q }) {
		super(ctx);
		this.q = q;
		this.el = el(`<section class="page">${bar({ title: esc(q) })}
			<div class="seg sticky-seg"><button class="on" data-t="top">Top</button><button data-t="latest">Latest</button><button data-t="people">People</button></div>
			<div class="scroll"><div class="list"></div></div></section>`);
		wireBack(this);
		bindPostActions(this.el, ctx);
		bindUserCells(this.el, ctx);
		this.el.querySelector(".seg").addEventListener("click", (e) => {
			const b = e.target.closest("button");
			if (!b || b.classList.contains("on")) return;
			$$(".seg button", this.el).forEach((x) => x.classList.toggle("on", x === b));
			this.mode(b.dataset.t);
		});
		this.mode("top");
	}
	mode(t) {
		const { ctx, q } = this;
		const list = $(".list", this.el);
		list.innerHTML = "";
		$$(".sentinel, .ptr", this.el).forEach((n) => n.remove());
		this.feed?.destroy();
		this.feed = null;
		if (t === "people") {
			list.innerHTML = `<div class="loading">${spinnerSvg}</div>`;
			ctx.api.searchUsers(q.replace(/^@/, ""), 40).then(
				(users) => (list.innerHTML = users.length ? users.map((u) => userCell(u, { me: ctx.account.user.screen_name })).join("") : `<div class="empty">No people match “${esc(q)}”.</div>`),
				(e) => (list.innerHTML = `<div class="empty">${esc(e.message)}</div>`),
			);
			return;
		}
		this.feed = new Feed({ ctx, scroller: this.scroller, list, load: (cursor) => ctx.api.searchPosts(q, { sort: t === "top" ? "top" : undefined, cursor }), empty: `<b>No results for “${esc(q)}”</b><p>Try searching for something else.</p>` });
		this.feed.more();
	}
	destroy() {
		this.feed?.destroy();
	}
}

// ---- Settings

export class SettingsPage extends Page {
	constructor(ctx) {
		super(ctx);
		this.el = el(`<section class="page settings">${bar({ title: "Settings" })}<div class="scroll"><div class="settings-body"></div></div></section>`);
		wireBack(this);
		this.render();
		this.off = ctx.app.onAccounts(() => this.render());
	}
	render() {
		const { ctx } = this;
		const p = prefs();
		const list = ctx.app.accounts();
		const perm = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
		const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
		$(".settings-body", this.el).innerHTML = `
			<div class="group-label">Accounts</div>
			<div class="group">${list.map((a) => `<div class="row press" data-switch="${esc(a.key)}">${avatar(a.user, "av sm")}<div class="row-main"><b>${esc(a.user.name || a.user.screen_name)}</b><span>@${esc(a.user.screen_name)} · ${esc(a.instance)}</span></div>${a.key === ctx.account.key ? icon("check", "accent") : ""}<button class="row-x" data-remove="${esc(a.key)}" aria-label="Sign out">${icon("logout")}</button></div>`).join("")}
				<button class="row press" data-add>${icon("plus", "accent")}<div class="row-main"><b class="accent-text">Add an existing account</b><span>Any Xitter instance</span></div></button></div>
			<div class="group-label">Display</div>
			<div class="group">${[["system", "Use device setting"], ["light", "Light"], ["dim", "Dim"], ["dark", "Lights out"]].map(([v, l]) => `<button class="row press" data-theme="${v}"><div class="row-main"><b>${l}</b></div>${p.theme === v ? icon("check", "accent") : ""}</button>`).join("")}</div>
			<div class="group-label">Notifications</div>
			<div class="group">
				<div class="row"><div class="row-main"><b>Alerts on this device</b><span>${perm === "granted" ? "On" : perm === "denied" ? "Blocked in your browser's settings" : perm === "unsupported" ? (standalone ? "Not supported here" : "Add Xitter to your Home Screen first") : "Off"}</span></div>${perm === "default" ? `<button class="pill-btn solid small" data-perm>Turn on</button>` : ""}</div>
				<button class="row press" data-toggle="notifyAll"><div class="row-main"><b>Alerts for every account</b><span>Not just the one you're using</span></div><span class="switch ${p.notifyAll ? "on" : ""}"></span></button>
				<div class="row"><div class="row-main"><span class="fine">Xitter's API has no push channel, so this app checks each account for replies, mentions, follows, likes and reposts every minute while it's open${"periodicSync" in ServiceWorkerRegistration.prototype ? ", and in the background every so often on this device" : ""}.</span></div></div>
			</div>
			<div class="group-label">Media</div>
			<div class="group"><button class="row press" data-toggle="autoplay"><div class="row-main"><b>Autoplay videos</b></div><span class="switch ${p.autoplay ? "on" : ""}"></span></button></div>
			<div class="group-label">About</div>
			<div class="group">
				<a class="row press" href="${esc(ctx.api.origin)}/account/api" target="_blank" rel="noopener"><div class="row-main"><b>API tokens on ${esc(ctx.account.instance)}</b><span>Review or revoke what this app uses</span></div></a>
				<a class="row press" href="${esc(ctx.api.origin)}/rules" target="_blank" rel="noopener"><div class="row-main"><b>${esc(ctx.account.instance)} rules</b></div></a>
				<a class="row press" href="https://github.com/Xittered/xitter" target="_blank" rel="noopener"><div class="row-main"><b>Xitter server source</b></div></a>
			</div>
			<p class="fine center">Xitter PWA · v1.0.0</p>`;
		const body = $(".settings-body", this.el);
		body.onclick = async (e) => {
			const t = e.target;
			const rm = t.closest("[data-remove]");
			if (rm) {
				e.stopPropagation();
				const a = list.find((x) => x.key === rm.dataset.remove);
				const ok = await actionSheet([{ label: "Sign out", danger: true, value: true }], { title: `Sign out of @${a.user.screen_name} on ${a.instance}?` });
				if (ok) ctx.app.signOut(a.key);
				return;
			}
			const sw = t.closest("[data-switch]");
			if (sw) return sw.dataset.switch !== ctx.account.key && ctx.app.switchTo(sw.dataset.switch);
			if (t.closest("[data-add]")) return ctx.app.addAccount();
			const th = t.closest("[data-theme]");
			if (th) {
				setPref("theme", th.dataset.theme);
				return this.render();
			}
			const tg = t.closest("[data-toggle]");
			if (tg) {
				setPref(tg.dataset.toggle, !prefs()[tg.dataset.toggle]);
				return this.render();
			}
			if (t.closest("[data-perm]")) {
				await ctx.app.requestNotifications();
				this.render();
			}
		};
	}
	destroy() {
		this.off?.();
	}
}
