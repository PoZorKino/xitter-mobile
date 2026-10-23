// Navigation the way iOS does it: every tab keeps its own stack of pages,
// pushes slide in from the right over a dimmed parallax of the page below,
// and a swipe from the left edge drags the top page back interactively.
// Sheets (compose, action sheets, the account switcher) slide up from below.
// Browser/Android back pops whatever is on top.

import { el, haptic } from "./util.js";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)"; // UIKit-ish spring, no overshoot
const DURATION = 420;
const PARALLAX = -0.3;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- back-button bookkeeping, shared by every stack and sheet
const backStack = []; // functions that close the top thing, newest last
let ignorePops = 0;
export function pushBack(close) {
	backStack.push(close);
	history.pushState({ xit: backStack.length }, "");
}
// the thing closed itself (button, swipe): drop its history entry quietly
export function dropBack(close) {
	const i = backStack.lastIndexOf(close);
	if (i === -1) return;
	backStack.splice(i, 1);
	ignorePops++;
	history.back();
}
window.addEventListener("popstate", () => {
	if (ignorePops) {
		ignorePops--;
		return;
	}
	const close = backStack.pop();
	close?.(true);
});

export class Page {
	// subclasses fill this.el (a .page) and may implement show/hide/destroy
	constructor(ctx) {
		this.ctx = ctx;
	}
	get scroller() {
		return this.el.querySelector(".scroll");
	}
	show() {}
	hide() {}
	destroy() {}
	scrollTop() {
		this.scroller?.scrollTo({ top: 0, behavior: "smooth" });
	}
}

export class Stack {
	constructor(root, makeRoot) {
		this.root = root; // .stack element
		this.pages = [];
		this.busy = false;
		this.makeRoot = makeRoot;
		this.attachEdgeSwipe();
	}
	get top() {
		return this.pages[this.pages.length - 1];
	}
	ensureRoot() {
		if (!this.pages.length) {
			const p = this.makeRoot();
			p.el.classList.add("page");
			this.root.append(p.el);
			this.pages.push(p);
			p.show();
		}
		return this.pages[0];
	}

	push(page, { animate = true } = {}) {
		if (this.busy) return;
		const below = this.top;
		page.el.classList.add("page");
		this.root.append(page.el);
		this.pages.push(page);
		page._back = (fromHistory) => this.pop({ fromHistory, page });
		pushBack(page._back);
		page.show();
		if (!animate || reduced()) {
			below?.el.classList.add("covered");
			below?.hide();
			return;
		}
		this.busy = true;
		const dim = this.dim(below);
		const w = this.root.clientWidth;
		const a = page.el.animate([{ transform: `translate3d(${w}px,0,0)` }, { transform: "translate3d(0,0,0)" }], { duration: DURATION, easing: EASE });
		below?.el.animate([{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(${w * PARALLAX}px,0,0)` }], { duration: DURATION, easing: EASE });
		dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: EASE, fill: "forwards" });
		a.onfinish = () => {
			dim.remove();
			below?.el.classList.add("covered");
			below?.hide();
			this.busy = false;
		};
	}

	pop({ fromHistory = false, page, animate = true, from = 0 } = {}) {
		if (this.pages.length < 2 || (this.busy && !from)) return;
		const top = this.top;
		if (page && page !== top) return;
		const below = this.pages[this.pages.length - 2];
		this.pages.pop();
		this.onChange?.();
		if (!fromHistory) dropBack(top._back);
		below.el.classList.remove("covered");
		below.show();
		const done = () => {
			top.el.remove();
			top.destroy();
			this.busy = false;
		};
		if (!animate || reduced()) return done();
		this.busy = true;
		const w = this.root.clientWidth;
		const dim = this.dim(below);
		const dur = DURATION * (1 - from) * 0.9 + 120;
		const a = top.el.animate([{ transform: `translate3d(${w * from}px,0,0)` }, { transform: `translate3d(${w}px,0,0)` }], { duration: dur, easing: EASE, fill: "forwards" });
		below.el.animate([{ transform: `translate3d(${w * PARALLAX * (1 - from)}px,0,0)` }, { transform: "translate3d(0,0,0)" }], { duration: dur, easing: EASE });
		dim.animate([{ opacity: 1 - from }, { opacity: 0 }], { duration: dur, easing: EASE, fill: "forwards" });
		a.onfinish = () => {
			dim.remove();
			done();
		};
	}

	popToRoot() {
		while (this.pages.length > 2) {
			const p = this.pages.pop();
			dropBack(p._back);
			p.el.remove();
			p.destroy();
		}
		this.pages.forEach((p) => p.el.classList.remove("covered"));
		this.pop();
	}

	dim(below) {
		const d = el(`<div class="page-dim"></div>`);
		if (below) below.el.after(d);
		return d;
	}

	// drag from the left edge to go back, like UINavigationController
	attachEdgeSwipe() {
		let start = null;
		const root = this.root;
		root.addEventListener("touchstart", (e) => {
			if (this.pages.length < 2 || this.busy || e.touches.length > 1) return;
			const t = e.touches[0];
			if (t.clientX > 28) return;
			start = { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0, active: false, v: 0, lastX: t.clientX, lastT: performance.now() };
		}, { passive: true });
		root.addEventListener("touchmove", (e) => {
			if (!start) return;
			const t = e.touches[0];
			const dx = t.clientX - start.x, dy = t.clientY - start.y;
			if (!start.active) {
				if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (start = null);
				if (dx < 8) return;
				start.active = true;
				start.dim = this.dim(this.pages[this.pages.length - 2]);
				this.pages[this.pages.length - 2].el.classList.remove("covered");
				this.root.classList.add("swiping");
			}
			e.preventDefault();
			const w = root.clientWidth;
			const x = Math.max(0, dx);
			const now = performance.now();
			start.v = (t.clientX - start.lastX) / Math.max(1, now - start.lastT);
			start.lastX = t.clientX;
			start.lastT = now;
			start.dx = x;
			this.top.el.style.transform = `translate3d(${x}px,0,0)`;
			this.pages[this.pages.length - 2].el.style.transform = `translate3d(${w * PARALLAX * (1 - x / w)}px,0,0)`;
			start.dim.style.opacity = String(1 - x / w);
		}, { passive: false });
		const end = () => {
			if (!start) return;
			const s = start;
			start = null;
			if (!s.active) return;
			this.root.classList.remove("swiping");
			const w = root.clientWidth;
			const top = this.top, below = this.pages[this.pages.length - 2];
			const progress = s.dx / w;
			top.el.style.transform = "";
			below.el.style.transform = "";
			s.dim.remove();
			if (progress > 0.4 || s.v > 0.45) {
				haptic(6);
				this.pop({ from: progress });
			} else {
				// spring back
				const dim = this.dim(below);
				const dur = 260;
				top.el.animate([{ transform: `translate3d(${s.dx}px,0,0)` }, { transform: "translate3d(0,0,0)" }], { duration: dur, easing: EASE });
				below.el.animate([{ transform: `translate3d(${w * PARALLAX * (1 - progress)}px,0,0)` }, { transform: `translate3d(${w * PARALLAX}px,0,0)` }], { duration: dur, easing: EASE });
				dim.animate([{ opacity: 1 - progress }, { opacity: 1 }], { duration: dur, easing: EASE }).onfinish = () => {
					dim.remove();
					below.el.classList.add("covered");
				};
			}
		};
		root.addEventListener("touchend", end);
		root.addEventListener("touchcancel", end);
	}
}

// ---- sheets: slide up from the bottom, drag down to dismiss

const overlayRoot = () => document.getElementById("overlay-root");

export function sheet(content, { full = false, onClose, className = "" } = {}) {
	const wrap = el(`<div class="sheet-wrap ${full ? "full" : ""} ${className}"><div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true">${full ? "" : `<div class="grabber"></div>`}</div></div>`);
	const panel = wrap.querySelector(".sheet");
	if (typeof content === "string") panel.insertAdjacentHTML("beforeend", content);
	else panel.append(content);
	overlayRoot().append(wrap);
	if (full) document.body.classList.add("card-open");
	let closed = false;
	const close = (fromHistory) => {
		if (closed) return;
		closed = true;
		if (fromHistory !== true) dropBack(close);
		if (full && document.querySelectorAll(".sheet-wrap.full").length <= 1) document.body.classList.remove("card-open");
		const dur = reduced() ? 0 : 300;
		const cur = getComputedStyle(panel).transform;
		panel.animate([{ transform: cur === "none" ? "translate3d(0,0,0)" : cur }, { transform: "translate3d(0,100%,0)" }], { duration: dur, easing: EASE, fill: "forwards" });
		wrap.querySelector(".sheet-backdrop").animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, fill: "forwards" }).onfinish = () => {
			wrap.remove();
			onClose?.();
		};
	};
	pushBack(close);
	if (!reduced()) {
		panel.animate([{ transform: "translate3d(0,100%,0)" }, { transform: "translate3d(0,0,0)" }], { duration: full ? 460 : 400, easing: EASE });
		wrap.querySelector(".sheet-backdrop").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
	}
	wrap.querySelector(".sheet-backdrop").addEventListener("click", () => close());

	// drag to dismiss (from the grabber area, or anywhere when content is scrolled to the top)
	let drag = null;
	panel.addEventListener("touchstart", (e) => {
		const scroller = e.target.closest(".sheet-scroll");
		if (scroller && scroller.scrollTop > 0) return;
		if (e.target.closest("textarea, input, .no-drag")) return;
		drag = { y: e.touches[0].clientY, dy: 0, t: performance.now() };
	}, { passive: true });
	panel.addEventListener("touchmove", (e) => {
		if (!drag) return;
		drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
		if (drag.dy > 4) {
			panel.style.transform = `translate3d(0,${drag.dy}px,0)`;
			panel.style.transition = "none";
		}
	}, { passive: true });
	panel.addEventListener("touchend", () => {
		if (!drag) return;
		const v = drag.dy / (performance.now() - drag.t);
		const dy = drag.dy;
		drag = null;
		if (dy > 140 || (v > 0.6 && dy > 30)) close();
		else if (dy > 0) {
			panel.animate([{ transform: `translate3d(0,${dy}px,0)` }, { transform: "translate3d(0,0,0)" }], { duration: 250, easing: EASE });
			panel.style.transform = "";
		}
	});
	return { el: panel, wrap, close };
}

// an iOS action sheet: list of actions plus Cancel
export function actionSheet(actions, { title } = {}) {
	return new Promise((resolve) => {
		let chosen = null;
		const body = el(`<div class="actions">${title ? `<div class="actions-title">${title}</div>` : ""}${actions
			.map((a, i) => `<button class="action press ${a.danger ? "danger" : ""}" data-i="${i}">${a.icon ? `<svg class="ic"><use href="#i-${a.icon}"/></svg>` : ""}<span>${a.label}</span></button>`)
			.join("")}<button class="action cancel press" data-i="-1">Cancel</button></div>`);
		const s = sheet(body, { onClose: () => resolve(chosen) });
		body.addEventListener("click", (e) => {
			const b = e.target.closest("[data-i]");
			if (!b) return;
			const i = Number(b.dataset.i);
			chosen = i >= 0 ? actions[i].value ?? i : null;
			haptic(5);
			s.close();
		});
	});
}

// drop-down banner like an iOS notification, and a quieter bottom toast
export function banner({ title, body, avatar, onTap, timeout = 4500 }) {
	const b = el(`<div class="ios-banner press"><img class="av" src="${avatar || "icons/icon-192.png"}" alt=""><div class="banner-text"><b></b><span></span></div></div>`);
	b.querySelector("b").textContent = title;
	b.querySelector("span").textContent = body || "";
	document.getElementById("toast-root").append(b);
	const hide = () => {
		if (!b.isConnected) return;
		b.animate([{ transform: "translate3d(-50%,0,0)", opacity: 1 }, { transform: "translate3d(-50%,-130%,0)", opacity: 0 }], { duration: 300, easing: EASE, fill: "forwards" }).onfinish = () => b.remove();
	};
	b.animate([{ transform: "translate3d(-50%,-130%,0)" }, { transform: "translate3d(-50%,0,0)" }], { duration: 450, easing: EASE });
	b.addEventListener("click", () => {
		hide();
		onTap?.();
	});
	let y0 = null;
	b.addEventListener("touchstart", (e) => (y0 = e.touches[0].clientY), { passive: true });
	b.addEventListener("touchmove", (e) => {
		if (y0 !== null && e.touches[0].clientY - y0 < -15) {
			y0 = null;
			hide();
		}
	}, { passive: true });
	setTimeout(hide, timeout);
}

export function toast(text, { error = false } = {}) {
	const t = el(`<div class="toast ${error ? "error" : ""}"></div>`);
	t.textContent = text;
	const root = document.getElementById("toast-root");
	// one at a time: a new toast replaces the one still fading, instead of piling up
	root.replaceChildren(t);
	t.animate([{ transform: "translate3d(-50%,20px,0)", opacity: 0 }, { transform: "translate3d(-50%,0,0)", opacity: 1 }], { duration: 300, easing: EASE });
	setTimeout(() => {
		t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }).onfinish = () => t.remove();
	}, 2600);
}
