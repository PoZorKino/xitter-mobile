// How a post looks and what tapping on it does, plus the infinite feed that
// lists them (pull to refresh, paging, new-posts pill).

import { onPostDelete, onPostUpdate } from "./api.js";
import { actionSheet, sheet, toast } from "./nav.js";
import { $$, ago, avatar, count, el, esc, fullDate, haptic, icon, isRemote, rafThrottle, richText, verifiedBadge, verifiedKind } from "./util.js";

// ---- markup

function mediaGrid(media, sensitive) {
	if (!media?.length) return "";
	const n = Math.min(media.length, 4);
	const one = n === 1 ? media[0] : null;
	const ratio = one && one.width && one.height ? Math.max(0.56, Math.min(1.78, one.width / one.height)) : 16 / 9;
	const style = one ? `style="aspect-ratio:${ratio}"` : "";
	return `<div class="media n${n} ${sensitive ? "sensitive" : ""}" ${style}>${media
		.slice(0, 4)
		.map((m, i) => {
			const alt = esc(m.alt_text || "");
			if (m.type === "video")
				return `<div class="m m-video" data-act="media" data-i="${i}"><video src="${esc(m.url)}" poster="${esc(m.poster_url || "")}" preload="none" playsinline muted loop></video><span class="play">${playIcon}</span></div>`;
			if (m.type === "gif")
				return `<div class="m" data-act="media" data-i="${i}"><video src="${esc(m.url)}" autoplay playsinline muted loop></video><span class="gif-tag">GIF</span></div>`;
			return `<div class="m" data-act="media" data-i="${i}"><img src="${esc(m.url)}" alt="${alt}" loading="lazy" decoding="async">${m.alt_text ? `<span class="alt-tag">ALT</span>` : ""}</div>`;
		})
		.join("")}${sensitive ? `<button class="sensitive-cover" data-act="reveal"><b>Content warning</b><span>The author flagged this as sensitive.</span><em>Show</em></button>` : ""}</div>`;
}
const playIcon = `<svg viewBox="0 0 24 24"><path fill="#fff" d="M8 5.5v13l10.5-6.5z"/></svg>`;

function nameLine(u, { time, id } = {}) {
	return `<span class="name-line"><span class="name" data-act="user">${esc(u.name || u.screen_name)}</span>${verifiedBadge(u)}${u.protected ? icon("lock", "lock") : ""}${isRemote(u) ? icon("globe", "globe") : ""}<span class="handle" data-act="user">@${esc(u.screen_name)}</span>${time ? `<span class="dot">·</span><time datetime="${esc(time)}">${ago(time)}</time>` : ""}</span>`;
}

function actionsRow(p, big = false) {
	const v = p.viewer || {}, c = p.counts || {};
	const btn = (act, ic, on, n, cls) =>
		`<button class="act ${cls} ${on ? "on" : ""}" data-act="${act}" aria-label="${act}">${icon(on ? ic + "-f" : ic)}${big ? "" : `<span class="n">${n ? count(n) : ""}</span>`}</button>`;
	return `<div class="actions-row ${big ? "big" : ""}">
		${btn("reply", "reply", false, c.replies, "a-reply")}
		<button class="act a-repost ${v.reposted ? "on" : ""}" data-act="repost" aria-label="repost">${icon("repost")}${big ? "" : `<span class="n">${c.reposts ? count(c.reposts) : ""}</span>`}</button>
		${btn("like", "heart", v.liked, c.likes, "a-like")}
		<span class="act-end">${btn("bookmark", "bookmark", v.bookmarked, 0, "a-bm")}<button class="act a-share" data-act="share" aria-label="share">${icon("share")}</button></span>
	</div>`;
}

// long posts are folded in lists, with a button to unfold
const isLong = (text) => !!text && (text.length > 320 || (text.match(/\n/g) || []).length > 7);

export function postHtml(p, { repost, threadUp = false, threadDown = false, reason } = {}) {
	const a = p.author;
	const long = isLong(p.text);
	return `<article class="post press ${threadUp ? "t-up" : ""} ${threadDown ? "t-down" : ""}" data-pid="${esc(p.id)}" data-user="${esc(a.screen_name)}">
		${repost ? `<div class="social">${icon("repost")}<span data-act="user" data-user="${esc(repost.screen_name)}">${esc(repost.name || repost.screen_name)} reposted</span></div>` : ""}
		${reason ? `<div class="social">${reason}</div>` : ""}
		<div class="post-grid">
			<div class="post-left" data-act="user">${avatar(a)}</div>
			<div class="post-body">
				<div class="post-head">${nameLine(a, { time: p.created_at })}<button class="more" data-act="more" aria-label="More">${icon("more")}</button></div>
				${p.reply_to ? `<div class="replying" data-reply="${esc(p.reply_to)}"></div>` : ""}
				${p.text ? `<div class="text ${long ? "folded" : ""}">${richText(p.text)}</div>${long ? `<button class="show-more" data-act="show-more">Show more</button>` : ""}` : ""}
				${mediaGrid(p.media, p.sensitive)}
				${p.quote_of ? `<div class="quote-slot" data-quote="${esc(p.quote_of)}"><div class="quote skeleton"></div></div>` : ""}
				${actionsRow(p)}
			</div>
		</div>
	</article>`;
}

// the large version at the top of a post's page
export function focusHtml(p) {
	const a = p.author, c = p.counts || {};
	const stat = (n, label, act) => (n ? `<button class="stat" ${act ? `data-act="${act}"` : ""}><b>${count(n)}</b> ${label}${n === 1 ? "" : "s"}</button>` : "");
	return `<article class="post focus" data-pid="${esc(p.id)}" data-user="${esc(a.screen_name)}">
		<div class="focus-head">
			<div data-act="user">${avatar(a)}</div>
			<div class="focus-names" data-act="user"><div class="name-row"><span class="name">${esc(a.name || a.screen_name)}</span>${verifiedBadge(a)}${a.protected ? icon("lock", "lock") : ""}${isRemote(a) ? icon("globe", "globe") : ""}</div><span class="handle">@${esc(a.screen_name)}</span></div>
			<button class="more" data-act="more" aria-label="More">${icon("more")}</button>
		</div>
		${p.reply_to ? `<div class="replying" data-reply="${esc(p.reply_to)}"></div>` : ""}
		${p.text ? `<div class="text big">${richText(p.text)}</div>` : ""}
		${mediaGrid(p.media, p.sensitive)}
		${p.quote_of ? `<div class="quote-slot" data-quote="${esc(p.quote_of)}"><div class="quote skeleton"></div></div>` : ""}
		<div class="focus-meta"><time>${fullDate(p.created_at)}</time>${p.edited_at ? ` · <span>Edited</span>` : ""}${c.views ? ` · <b>${count(c.views)}</b> Views` : ""}</div>
		<div class="focus-stats">${stat(c.reposts, "Repost")}${stat(c.quotes, "Quote")}${stat(c.likes, "Like")}${stat(c.bookmarks, "Bookmark")}</div>
		${actionsRow(p, true)}
	</article>`;
}

function quoteHtml(q) {
	const a = q.author;
	const m = q.media?.[0];
	return `<div class="quote press" data-act="open-quote" data-qid="${esc(q.id)}">
		<div class="quote-head">${avatar(a, "av xs")}${nameLine(a, { time: q.created_at })}</div>
		<div class="quote-body">${q.text ? `<div class="text">${richText(q.text)}</div>` : ""}${m ? `<div class="quote-media"><img src="${esc(m.type === "video" ? m.poster_url : m.url)}" alt="" loading="lazy"></div>` : ""}</div>
	</div>`;
}

// ---- hydration: quoted posts and "Replying to" lines, fetched lazily
const queue = [];
let running = 0;
function enqueue(job) {
	queue.push(job);
	pump();
}
function pump() {
	while (running < 4 && queue.length) {
		running++;
		queue.shift()().finally(() => {
			running--;
			pump();
		});
	}
}
export function hydrate(root, api) {
	for (const slot of $$(".quote-slot[data-quote]:not([data-done])", root)) {
		slot.dataset.done = "1";
		enqueue(() =>
			api.post(slot.dataset.quote).then(
				(q) => void (slot.innerHTML = quoteHtml(q)),
				() => void (slot.innerHTML = `<div class="quote unavailable">This post is unavailable.</div>`),
			),
		);
	}
	for (const r of $$(".replying[data-reply]:not([data-done])", root)) {
		r.dataset.done = "1";
		const cached = api.posts.get(r.dataset.reply);
		const fill = (p) => void (r.innerHTML = `Replying to <a class="lnk" data-user="${esc(p.author.screen_name)}">@${esc(p.author.screen_name)}</a>`);
		if (cached) fill(cached);
		else enqueue(() => api.post(r.dataset.reply).then(fill, () => {}));
	}
}

// keep every copy of a post on screen in step
export function patchPost(root, p) {
	for (const node of $$(`.post[data-pid="${CSS.escape(p.id)}"]`, root)) {
		const row = node.querySelector(".actions-row");
		if (!row) continue;
		const big = row.classList.contains("big");
		const fresh = el(actionsRow(p, big));
		// keep the in-flight animation classes off; swap state only
		for (const act of ["reply", "repost", "like", "bookmark"]) {
			const a = row.querySelector(`[data-act="${act}"]`), b = fresh.querySelector(`[data-act="${act}"]`);
			if (!a || !b) continue;
			a.classList.toggle("on", b.classList.contains("on"));
			const use = a.querySelector("use"), use2 = b.querySelector("use");
			if (use && use2) use.setAttribute("href", use2.getAttribute("href"));
			const n = a.querySelector(".n"), n2 = b.querySelector(".n");
			if (n && n2 && n.textContent !== n2.textContent) rollCount(n, n2.textContent);
		}
		if (big) {
			const stats = node.querySelector(".focus-stats");
			if (stats) stats.outerHTML = el(focusHtml(p)).querySelector(".focus-stats").outerHTML;
		}
	}
}
function rollCount(n, text) {
	const up = (parseCount(text) || 0) >= (parseCount(n.textContent) || 0);
	n.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${up ? -8 : 8}px)`, opacity: 0 }], { duration: 120, easing: "ease-in" }).onfinish = () => {
		n.textContent = text;
		n.animate([{ transform: `translateY(${up ? 8 : -8}px)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 160, easing: "ease-out" });
	};
}
const parseCount = (s) => (s.endsWith("K") ? parseFloat(s) * 1e3 : s.endsWith("M") ? parseFloat(s) * 1e6 : Number(s));

// ---- taps on posts, delegated from a page

export function bindPostActions(root, ctx) {
	const { api } = ctx;
	let hold = null, held = false;
	const cancelHold = () => {
		if (!hold) return;
		clearTimeout(hold.timer);
		hold.post.classList.remove("holding");
		hold = null;
	};
	root.addEventListener("pointerdown", (e) => {
		const postEl = e.target.closest(".post");
		if (!postEl || e.button > 0 || e.target.closest("button, a, video, .quote, [data-act=media]")) return;
		held = false;
		const timer = setTimeout(() => {
			const p = api.posts.get(postEl.dataset.pid);
			if (!p) return;
			held = true;
			postEl.classList.remove("holding");
			haptic(15);
			hold = null;
			postMenu(p, postEl);
		}, 450);
		hold = { timer, post: postEl, x: e.clientX, y: e.clientY };
		postEl.classList.add("holding");
	});
	root.addEventListener("pointermove", (e) => hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8 && cancelHold());
	root.addEventListener("pointerup", cancelHold);
	root.addEventListener("pointercancel", cancelHold);
	root.addEventListener("scroll", cancelHold, { capture: true, passive: true });
	root.addEventListener("contextmenu", (e) => e.target.closest(".post") && !e.target.closest("a[href], img, video") && e.preventDefault());

	root.addEventListener("click", async (e) => {
		if (held) {
			// the tap that ended a press-and-hold isn't a tap
			held = false;
			e.stopPropagation();
			return;
		}
		const t = e.target;
		if (t.closest("a.lnk[href]")) return; // external link
		const userLink = t.closest("[data-user].lnk, .social [data-user]");
		if (userLink) {
			e.stopPropagation();
			return ctx.open("profile", { name: userLink.dataset.user });
		}
		const tag = t.closest("[data-tag]");
		if (tag) return ctx.open("search", { q: "#" + tag.dataset.tag });
		const orgBadge = t.closest("[data-org]");
		if (orgBadge) {
			e.stopPropagation();
			return ctx.open("profile", { name: orgBadge.dataset.org });
		}
		const check = t.closest("[data-verified]");
		if (check) {
			e.stopPropagation();
			const postEl = check.closest(".post, .quote");
			const p = postEl && api.posts.get(postEl.dataset.pid || postEl.dataset.qid);
			return p && explainBadge(p.author, ctx);
		}

		const postEl = t.closest(".post");
		const actEl = t.closest("[data-act]");
		const act = actEl?.dataset.act;
		if (!postEl) return;
		const id = postEl.dataset.pid;
		const p = api.posts.get(id);
		if (!p) return;

		switch (act) {
			case "user":
				return ctx.open("profile", { name: postEl.dataset.user, user: p.author });
			case "reply":
				return ctx.compose({ replyTo: p });
			case "like":
				return toggle(p, "like", "liked", "likes", actEl);
			case "bookmark":
				toggle(p, "bookmark", "bookmarked", "bookmarks", actEl);
				return toast(p.viewer.bookmarked ? "Removed from Bookmarks" : "Added to Bookmarks");
			case "repost": {
				haptic(6);
				const choice = await actionSheet([
					{ label: p.viewer?.reposted ? "Undo Repost" : "Repost", icon: "repost", value: "repost" },
					{ label: "Quote", icon: "quote", value: "quote" },
				]);
				if (choice === "repost") toggle(p, "repost", "reposted", "reposts", actEl);
				if (choice === "quote") ctx.compose({ quote: p });
				return;
			}
			case "share":
				return share(p);
			case "more":
				return more(p, ctx);
			case "media":
				e.stopPropagation();
				return ctx.viewMedia(p, Number(actEl.dataset.i));
			case "reveal":
				e.stopPropagation();
				actEl.parentElement.classList.remove("sensitive");
				return actEl.remove();
			case "open-quote":
				return ctx.open("post", { id: actEl.dataset.qid });
			case "show-more":
				e.stopPropagation();
				actEl.previousElementSibling?.classList.remove("folded");
				return actEl.remove();
			case "stat":
				return;
		}
		if (t.closest("button, a, video")) return;
		if (postEl.classList.contains("focus")) return;
		if (getSelection()?.toString()) return;
		ctx.open("post", { id, post: p });
	});

	// optimistic toggles with the X-style pop
	async function toggle(p, what, flag, countKey, btn) {
		const on = !p.viewer?.[flag];
		const optimistic = { ...p, viewer: { ...p.viewer, [flag]: on }, counts: { ...p.counts, [countKey]: Math.max(0, (p.counts?.[countKey] || 0) + (on ? 1 : -1)) } };
		haptic(on ? 10 : 5);
		if (on && btn) {
			btn.classList.remove("pop");
			void btn.offsetWidth;
			btn.classList.add("pop");
		}
		api.publish(optimistic);
		try {
			await api.toggle(p.id, what, on);
		} catch (err) {
			api.publish(p);
			toast(err.message, { error: true });
		}
	}

	async function share(p) {
		const url = p.url;
		if (navigator.share) {
			try {
				await navigator.share({ url, text: p.text?.slice(0, 100) });
			} catch {}
		} else {
			await navigator.clipboard?.writeText(url);
			toast("Copied to clipboard");
		}
	}

	async function postMenu(p, postEl) {
		const v = p.viewer || {};
		const mine = p.author.screen_name.toLowerCase() === ctx.account.user.screen_name.toLowerCase();
		const choice = await actionSheet([
			{ label: "Reply", icon: "reply", value: "reply" },
			{ label: v.reposted ? "Undo repost" : "Repost", icon: "repost", value: "repost" },
			{ label: "Quote", icon: "quote", value: "quote" },
			{ label: v.liked ? "Unlike" : "Like", icon: v.liked ? "heart-f" : "heart", value: "like" },
			{ label: v.bookmarked ? "Remove bookmark" : "Bookmark", icon: v.bookmarked ? "bookmark-f" : "bookmark", value: "bookmark" },
			{ label: "Share", icon: "share", value: "share" },
			{ label: "Copy link", icon: "link", value: "copy" },
			...(!mine ? [{ label: `View @${p.author.screen_name}`, icon: "user", value: "profile" }] : []),
			...(mine ? [{ label: "Delete post", icon: "trash", value: "delete", danger: true }] : []),
		]);
		const btn = (act) => postEl.querySelector(`.actions-row [data-act="${act}"]`);
		const cur = api.posts.get(p.id) || p;
		if (choice === "reply") ctx.compose({ replyTo: cur });
		else if (choice === "repost") toggle(cur, "repost", "reposted", "reposts", btn("repost"));
		else if (choice === "quote") ctx.compose({ quote: cur });
		else if (choice === "like") toggle(cur, "like", "liked", "likes", btn("like"));
		else if (choice === "bookmark") {
			toggle(cur, "bookmark", "bookmarked", "bookmarks", btn("bookmark"));
			toast(cur.viewer?.bookmarked ? "Removed from Bookmarks" : "Added to Bookmarks");
		} else if (choice === "share") share(cur);
		else if (choice === "copy") {
			await navigator.clipboard?.writeText(cur.url);
			toast("Copied to clipboard");
		} else if (choice === "profile") ctx.open("profile", { name: cur.author.screen_name, user: cur.author });
		else if (choice === "delete") deletePost(cur);
	}

	async function deletePost(p) {
		const sure = await actionSheet([{ label: "Delete", danger: true, value: true }], { title: "Delete post? This can't be undone." });
		if (!sure) return;
		try {
			await api.deletePost(p.id);
			toast("Your post was deleted");
		} catch (err) {
			toast(err.message, { error: true });
		}
	}

	async function more(p, ctx) {
		const mine = p.author.screen_name.toLowerCase() === ctx.account.user.screen_name.toLowerCase();
		const choice = await actionSheet([
			...(mine ? [{ label: "Delete post", icon: "trash", value: "delete", danger: true }] : []),
			{ label: "Copy link", icon: "link", value: "copy" },
			{ label: `View on ${ctx.account.instance}`, icon: "globe", value: "web" },
			...(!mine ? [{ label: `View @${p.author.screen_name}`, icon: "user", value: "profile" }] : []),
		]);
		if (choice === "copy") {
			await navigator.clipboard?.writeText(p.url);
			toast("Copied to clipboard");
		} else if (choice === "web") window.open(p.url, "_blank", "noopener");
		else if (choice === "profile") ctx.open("profile", { name: p.author.screen_name, user: p.author });
		else if (choice === "delete") deletePost(p);
	}
}

// the sheet a checkmark opens, like X's: why the account has it, and since when
export function explainBadge(u, ctx) {
	const kind = verifiedKind(u);
	if (!kind) return;
	const t = String(u.verified_type).toLowerCase();
	const org = u.affiliations?.[0];
	const why = org
		? `This account is verified because it's an affiliate of @${esc(org.screen_name)} on ${esc(ctx.account.instance)}.`
		: t === "business"
			? `This account is verified because it's an organisation on ${esc(ctx.account.instance)}.`
			: t === "government"
				? "This account is verified because it's a government or multilateral organisation account."
				: t === "government_individual"
					? "This account is verified because it belongs to a government or multilateral organisation official."
					: `This account is verified by the ${esc(ctx.account.instance)} team.`;
	const since = u.verified_since ? new Date(u.verified_since).toLocaleDateString([], { month: "long", year: "numeric" }) : "";
	const body = el(`<div class="badge-sheet">
		<svg class="vf big ${kind}"><use href="#i-verified"/></svg>
		<h2>${kind === "gold" ? "Verified organisation" : kind === "grey" ? "Government" : "Verified"}</h2>
		<p>${why}</p>
		${since ? `<p class="dim">Verified since ${esc(since)}</p>` : ""}
		${org ? `<button class="aff-chip press" data-org="${esc(org.screen_name)}"><img class="aff" src="${esc(org.badge_url || "")}" alt="">${esc(org.name)}</button>` : ""}
		<button class="pill-btn outline wide" data-close>Got it</button>
	</div>`);
	const s = sheet(body);
	body.addEventListener("click", (e) => {
		const o = e.target.closest("[data-org]");
		if (o) {
			s.close();
			ctx.open("profile", { name: o.dataset.org });
		}
		if (e.target.closest("[data-close]")) s.close();
	});
}

// listen for post updates/deletes for a whole account root
export function watchPosts(root, api) {
	const off1 = onPostUpdate(({ key, post }) => key === api.key && patchPost(root, post));
	const off2 = onPostDelete(({ key, id }) => {
		if (key !== api.key) return;
		for (const n of $$(`.post[data-pid="${CSS.escape(id)}"]`, root)) {
			n.animate([{ opacity: 1, height: n.offsetHeight + "px" }, { opacity: 0, height: "0px" }], { duration: 250, easing: "ease-in" }).onfinish = () => n.remove();
		}
	});
	return () => (off1(), off2());
}

// autoplay muted videos when mostly on screen
const videoObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
	for (const e of entries) {
		const v = e.target;
		if (e.isIntersecting && e.intersectionRatio > 0.6 && document.documentElement.dataset.autoplay !== "off") {
			if (v.preload === "none") v.preload = "metadata";
			v.play().then(() => v.parentElement?.classList.add("playing"), () => {});
		} else v.pause();
	}
}, { threshold: [0, 0.6] }) : null;
export function observeVideos(root) {
	if (!videoObserver) return;
	for (const v of $$(".m-video video:not([data-obs])", root)) {
		v.dataset.obs = "1";
		videoObserver.observe(v);
	}
}

// ---- an infinite feed with pull to refresh

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export class Feed {
	// load(cursor) -> { data: [post], next_cursor }
	constructor({ ctx, scroller, list, load, render = (p) => postHtml(p, { repost: p.reposted_by }), empty = "Nothing to see here — yet.", cached, onRefresh, pull = true, keyOf = (p) => p.id + (p.reposted_by ? ":r" + p.reposted_by.id : "") }) {
		Object.assign(this, { ctx, scroller, list, load, render, empty, onRefresh, keyOf });
		this.cursor = undefined;
		this.done = false;
		this.loading = false;
		this.keys = new Set();
		this.items = [];
		this.sentinel = el(`<div class="sentinel"><div class="spinner"></div></div>`);
		this.list.after(this.sentinel);
		this.io = new IntersectionObserver((e) => e[0].isIntersecting && this.more(), { root: scroller, rootMargin: "1200px 0px" });
		this.io.observe(this.sentinel);
		if (pull) {
			this.ptr = el(`<div class="ptr"><div class="ptr-spin">${spinnerSvg}</div></div>`);
			this.scroller.prepend(this.ptr);
			this.attachPull();
		}
		if (cached?.data?.length) {
			this.append(cached.data);
			this.cursor = cached.next_cursor ?? undefined;
			this.stale = true;
		}
	}

	append(posts, { prepend = false } = {}) {
		const fresh = posts.filter((p) => !this.keys.has(this.keyOf(p)));
		if (!fresh.length) return fresh;
		for (const p of fresh) {
			this.keys.add(this.keyOf(p));
			this.ctx.api.remember(p);
		}
		const markup = fresh.map((p) => this.render(p)).join("");
		if (prepend) {
			const before = this.scroller.scrollHeight;
			const top = this.scroller.scrollTop;
			this.list.insertAdjacentHTML("afterbegin", markup);
			this.items = [...fresh, ...this.items];
			// keep what you're reading where it is
			if (top > 4) this.scroller.scrollTop = top + (this.scroller.scrollHeight - before);
		} else {
			this.list.insertAdjacentHTML("beforeend", markup);
			this.items.push(...fresh);
		}
		hydrate(this.list, this.ctx.api);
		observeVideos(this.list);
		return fresh;
	}

	async more() {
		if (this.loading || this.done) return;
		this.loading = true;
		try {
			const out = await this.load(this.cursor);
			const posts = out.data ?? [];
			this.append(posts);
			this.cursor = out.next_cursor ?? undefined;
			if (!out.next_cursor) this.finish();
			if (!this.items.length) this.showEmpty();
		} catch (e) {
			this.sentinel.innerHTML = `<button class="retry">${esc(e.message)}<b>Retry</b></button>`;
			this.sentinel.querySelector("button").onclick = () => {
				this.sentinel.innerHTML = `<div class="spinner"></div>`;
				this.more();
			};
			this.loading = false;
			return;
		}
		this.loading = false;
	}

	anchor() {
		const top = this.scroller.getBoundingClientRect().top + parseFloat(getComputedStyle(this.scroller).paddingTop);
		for (const n of this.list.children) {
			const r = n.getBoundingClientRect();
			if (r.bottom > top && n.dataset.pid) return { pid: n.dataset.pid, offset: Math.round(top - r.top) };
		}
		return null;
	}
	restore(a) {
		const n = a && this.list.querySelector(`.post[data-pid="${CSS.escape(a.pid)}"]`);
		if (!n) return false;
		const pad = parseFloat(getComputedStyle(this.scroller).paddingTop);
		this.scroller.scrollTop = n.offsetTop - pad + a.offset;
		return true;
	}

	finish() {
		this.done = true;
		this.sentinel.innerHTML = "";
		this.sentinel.classList.add("end");
	}
	showEmpty() {
		this.list.innerHTML = `<div class="empty">${this.empty}</div>`;
	}

	// start over from the top (pull to refresh). New items slide in.
	async refresh() {
		try {
			const out = await this.load(undefined);
			const posts = out.data ?? [];
			const overlap = posts.some((p) => this.keys.has(this.keyOf(p)));
			if (this.stale && overlap) {
				// the snapshot still joins up with what's new: refresh its counts and
				// put the new posts above it, so you stay where you were reading
				this.stale = false;
				for (const p of posts) if (this.keys.has(this.keyOf(p))) this.ctx.api.publish(p);
				const fresh = this.append(posts, { prepend: true });
				if (this.scroller.scrollTop <= 4) for (const n of [...this.list.children].slice(0, fresh.length)) n.classList.add("arrive");
			} else if (this.stale || !this.items.length) {
				// replace the snapshot outright
				this.stale = false;
				this.list.innerHTML = "";
				this.keys.clear();
				this.items = [];
				this.done = false;
				this.sentinel.classList.remove("end");
				this.sentinel.innerHTML = `<div class="spinner"></div>`;
				this.append(posts);
				this.cursor = out.next_cursor ?? undefined;
				if (!out.next_cursor) this.finish();
				if (!posts.length) this.showEmpty();
			} else {
				const fresh = this.append(posts, { prepend: true });
				for (const n of [...this.list.children].slice(0, fresh.length)) n.classList.add("arrive");
			}
			this.onRefresh?.(out);
			return out;
		} catch (e) {
			toast(e.message, { error: true });
		}
	}

	// iOS: ride the native rubber band; elsewhere: drag the list down
	attachPull() {
		const s = this.scroller;
		const spin = this.ptr.querySelector(".ptr-spin");
		let armed = false, refreshing = false;
		const go = async () => {
			if (refreshing) return;
			refreshing = true;
			haptic(10);
			this.ptr.classList.add("refreshing");
			await Promise.all([this.refresh(), new Promise((r) => setTimeout(r, 450))]);
			this.ptr.classList.remove("refreshing");
			refreshing = false;
		};
		if (IOS) {
			this.ptr.classList.add("ios");
			s.addEventListener("scroll", rafThrottle(() => {
				const pull = -s.scrollTop;
				if (refreshing) return;
				spin.style.opacity = String(Math.min(1, pull / 70));
				spin.style.transform = `rotate(${pull * 3}deg)`;
				if (pull > 75 && !armed) {
					armed = true;
					haptic(8);
				}
			}), { passive: true });
			s.addEventListener("touchend", () => {
				if (armed) {
					armed = false;
					go();
				}
			});
			return;
		}
		let y0 = null, pull = 0;
		s.addEventListener("touchstart", (e) => {
			if (s.scrollTop <= 0 && !refreshing) y0 = e.touches[0].clientY;
		}, { passive: true });
		s.addEventListener("touchmove", (e) => {
			if (y0 === null) return;
			const dy = e.touches[0].clientY - y0;
			if (dy <= 0 || s.scrollTop > 0) {
				pull = 0;
				this.list.style.transform = this.ptr.style.transform = "";
				return;
			}
			pull = Math.min(130, dy * 0.5);
			this.list.style.transform = `translate3d(0,${pull}px,0)`;
			this.ptr.style.transform = `translate3d(0,${pull}px,0)`;
			spin.style.opacity = String(Math.min(1, pull / 70));
			spin.style.transform = `rotate(${pull * 4}deg)`;
			if (pull > 70 !== armed) {
				armed = pull > 70;
				if (armed) haptic(8);
			}
		}, { passive: true });
		s.addEventListener("touchend", () => {
			if (y0 === null) return;
			y0 = null;
			const from = pull;
			pull = 0;
			const settle = (to) => {
				this.list.animate([{ transform: `translate3d(0,${from}px,0)` }, { transform: `translate3d(0,${to}px,0)` }], { duration: 300, easing: "cubic-bezier(0.32,0.72,0,1)" });
				this.ptr.animate([{ transform: `translate3d(0,${from}px,0)` }, { transform: `translate3d(0,${to}px,0)` }], { duration: 300, easing: "cubic-bezier(0.32,0.72,0,1)" });
				this.list.style.transform = to ? `translate3d(0,${to}px,0)` : "";
				this.ptr.style.transform = to ? `translate3d(0,${to}px,0)` : "";
			};
			if (armed) {
				armed = false;
				settle(56);
				go().then(() => {
					const cur = 56;
					this.list.animate([{ transform: `translate3d(0,${cur}px,0)` }, { transform: "translate3d(0,0,0)" }], { duration: 300, easing: "cubic-bezier(0.32,0.72,0,1)" });
					this.ptr.animate([{ transform: `translate3d(0,${cur}px,0)` }, { transform: "translate3d(0,0,0)" }], { duration: 300, easing: "cubic-bezier(0.32,0.72,0,1)" });
					this.list.style.transform = this.ptr.style.transform = "";
				});
			} else if (from) settle(0);
		});
	}

	destroy() {
		this.io.disconnect();
	}
}

export const spinnerSvg = `<svg viewBox="0 0 24 24" class="spin-svg"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="42 100"/></svg>`;

// timestamps tick while you watch
setInterval(() => {
	for (const t of $$(".post-head time[datetime], .quote-head time[datetime]")) t.textContent = ago(t.getAttribute("datetime"));
}, 30_000);
