// Full-screen media: grows out of the thumbnail you tapped, swipes sideways
// between photos, and drags down to dismiss back into place.

import { pushBack, dropBack } from "./nav.js";
import { bindPostActions, watchPosts } from "./post.js";
import { count, el, esc, icon } from "./util.js";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

export function viewMedia(ctx, post, index = 0, { images } = {}) {
	const media = images ? images.map((url) => ({ type: "photo", url })) : post.media;
	const src = post ? document.querySelector(`.acct-root.active .page:not(.covered) .post[data-pid="${CSS.escape(post.id)}"] .m[data-i="${index}"]`) : null;
	const v = post?.viewer || {}, c = post?.counts || {};
	const root = el(`<div class="viewer">
		<div class="viewer-bg"></div>
		<div class="viewer-track">${media
			.map((m, i) => `<div class="slide" data-i="${i}">${m.type !== "video" ? `<img src="${esc(m.url)}" alt="${esc(m.alt_text || "")}" draggable="false">` : `<video src="${esc(m.url)}" poster="${esc(m.poster_url || "")}" playsinline controls></video>`}</div>`)
			.join("")}</div>
		<div class="viewer-top"><button class="viewer-btn press" data-close aria-label="Close">${icon("close")}</button>${media.length > 1 ? `<span class="viewer-count"></span>` : ""}<span></span></div>
		${post ? `<div class="viewer-bottom post focus" data-pid="${esc(post.id)}" data-user="${esc(post.author.screen_name)}">
			${media[index]?.alt_text ? `<div class="viewer-alt"></div>` : ""}
			<div class="actions-row">
				<button class="act a-reply" data-act="reply">${icon("reply")}<span class="n">${c.replies ? count(c.replies) : ""}</span></button>
				<button class="act a-repost ${v.reposted ? "on" : ""}" data-act="repost">${icon("repost")}<span class="n">${c.reposts ? count(c.reposts) : ""}</span></button>
				<button class="act a-like ${v.liked ? "on" : ""}" data-act="like">${icon(v.liked ? "heart-f" : "heart")}<span class="n">${c.likes ? count(c.likes) : ""}</span></button>
				<span class="act-end"><button class="act a-bm ${v.bookmarked ? "on" : ""}" data-act="bookmark">${icon(v.bookmarked ? "bookmark-f" : "bookmark")}</button><button class="act a-share" data-act="share">${icon("share")}</button></span>
			</div></div>` : ""}
	</div>`);
	document.getElementById("overlay-root").append(root);
	const track = root.querySelector(".viewer-track");
	const bg = root.querySelector(".viewer-bg");
	const counter = root.querySelector(".viewer-count");
	const altBox = root.querySelector(".viewer-alt");
	let cur = index;
	const setCur = (i) => {
		cur = i;
		if (counter) counter.textContent = `${i + 1} / ${media.length}`;
		if (altBox) altBox.textContent = media[i]?.alt_text || "";
		root.querySelectorAll(".slide video").forEach((vid, j) => j !== i && vid.pause());
	};
	setCur(index);
	track.scrollLeft = index * innerWidth;
	track.addEventListener("scroll", () => {
		const i = Math.round(track.scrollLeft / track.clientWidth);
		if (i !== cur) setCur(i);
	}, { passive: true });
	if (post) bindPostActions(root, ctx);
	const unwatch = post ? watchPosts(root, ctx.api) : () => {};

	// open: grow from the thumbnail
	const target = () => root.querySelector(`.slide[data-i="${cur}"] img, .slide[data-i="${cur}"] video`);
	const flipFrom = (node, rect) => {
		const r = node.getBoundingClientRect();
		if (!r.width || !rect.width) return null;
		const sx = rect.width / r.width, sy = rect.height / r.height;
		const s = Math.max(sx, sy);
		return `translate3d(${rect.left + rect.width / 2 - (r.left + r.width / 2)}px, ${rect.top + rect.height / 2 - (r.top + r.height / 2)}px, 0) scale(${s})`;
	};
	const node = target();
	const rect = src?.getBoundingClientRect();
	const run = () => {
		const from = rect && flipFrom(node, rect);
		if (from) node.animate([{ transform: from, clipPath: "inset(0 round 16px)" }, { transform: "none", clipPath: "inset(0 round 0)" }], { duration: 380, easing: EASE });
		else node.animate([{ transform: "scale(.92)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 280, easing: EASE });
		bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, fill: "both" });
		if (src) src.style.visibility = "hidden";
	};
	if (node.tagName === "IMG" && !node.complete) node.decode().then(run, run);
	else run();

	let closed = false;
	const close = (fromHistory, dragY = 0) => {
		if (closed) return;
		closed = true;
		if (fromHistory !== true) dropBack(close);
		const n = target();
		const back = cur === index && src?.isConnected ? src : null;
		const r = back?.getBoundingClientRect();
		const to = r && n ? flipFrom(n, r) : null;
		const start = dragY ? `translate3d(0,${dragY}px,0) scale(${1 - Math.min(0.25, Math.abs(dragY) / 1200)})` : "none";
		const a = n?.animate([{ transform: start }, to ? { transform: to } : { transform: `translate3d(0,${dragY >= 0 ? innerHeight : -innerHeight}px,0)` }], { duration: to ? 340 : 280, easing: EASE, fill: "forwards" });
		root.querySelectorAll(".viewer-top, .viewer-bottom").forEach((x) => x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" }));
		bg.animate([{ opacity: getComputedStyle(bg).opacity }, { opacity: 0 }], { duration: 280, fill: "forwards" });
		const done = () => {
			unwatch();
			if (src) src.style.visibility = "";
			root.remove();
		};
		if (a) a.onfinish = done;
		else setTimeout(done, 280);
	};
	pushBack(close);
	root.querySelector("[data-close]").onclick = () => close();

	// tap toggles the chrome; drag vertically to dismiss
	let drag = null, moved = false;
	track.addEventListener("touchstart", (e) => {
		if (e.touches.length > 1) return (drag = null);
		drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, dy: 0, axis: null, t: performance.now() };
		moved = false;
	}, { passive: true });
	track.addEventListener("touchmove", (e) => {
		if (!drag) return;
		const dx = e.touches[0].clientX - drag.x, dy = e.touches[0].clientY - drag.y;
		if (!drag.axis && Math.hypot(dx, dy) > 8) drag.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
		if (drag.axis !== "y") return;
		e.preventDefault();
		moved = true;
		drag.dy = dy;
		const n = target();
		n.style.transform = `translate3d(0,${dy}px,0) scale(${1 - Math.min(0.25, Math.abs(dy) / 1200)})`;
		bg.style.opacity = String(Math.max(0, 1 - Math.abs(dy) / 350));
		root.classList.add("dragging");
	}, { passive: false });
	track.addEventListener("touchend", () => {
		if (!drag) return;
		const { dy, axis, t } = drag;
		drag = null;
		root.classList.remove("dragging");
		if (axis !== "y") return;
		const n = target();
		const v = Math.abs(dy) / (performance.now() - t);
		if (Math.abs(dy) > 110 || v > 0.7) {
			n.style.transform = "";
			close(false, dy);
		} else {
			n.animate([{ transform: n.style.transform }, { transform: "none" }], { duration: 260, easing: EASE });
			n.style.transform = "";
			bg.style.opacity = "";
		}
	});
	track.addEventListener("click", (e) => {
		if (moved || e.target.tagName === "VIDEO") return;
		root.classList.toggle("bare");
	});
	// desktop: keys
	const key = (e) => {
		if (!root.isConnected) return removeEventListener("keydown", key);
		if (e.key === "Escape") close();
		if (e.key === "ArrowRight") track.scrollBy({ left: track.clientWidth, behavior: "smooth" });
		if (e.key === "ArrowLeft") track.scrollBy({ left: -track.clientWidth, behavior: "smooth" });
	};
	addEventListener("keydown", key);
}
