// Small helpers shared by every screen.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const icon = (name, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// html`...` with escaped interpolations; raw(...) passes markup through
const RAW = Symbol("raw");
export const raw = (s) => ({ [RAW]: String(s) });
export function html(strings, ...vals) {
	let out = strings[0];
	for (let i = 0; i < vals.length; i++) {
		const v = vals[i];
		out += (Array.isArray(v) ? v.map((x) => (x && x[RAW] !== undefined ? x[RAW] : esc(x))).join("") : v && v[RAW] !== undefined ? v[RAW] : esc(v)) + strings[i + 1];
	}
	return raw(out);
}
export const toHtml = (r) => (r && r[RAW] !== undefined ? r[RAW] : esc(r));

export function el(markup) {
	const t = document.createElement("template");
	t.innerHTML = (typeof markup === "string" ? markup : toHtml(markup)).trim();
	return t.content.firstElementChild;
}

// X-style compact counts: 999, 1.2K, 12K, 1.2M
export function count(n) {
	n = Math.max(0, Number(n) || 0);
	if (n < 1000) return String(n);
	if (n < 10_000) return (Math.floor(n / 100) / 10).toString().replace(/\.0$/, "") + "K";
	if (n < 1_000_000) return Math.floor(n / 1000) + "K";
	return (Math.floor(n / 100_000) / 10).toString().replace(/\.0$/, "") + "M";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// timeline style: 12s, 5m, 3h, Oct 14, Oct 14, 2024
export function ago(iso) {
	if (!iso) return "";
	const d = new Date(iso);
	const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
	if (s < 60) return `${Math.floor(s) || 1}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	const now = new Date();
	return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : ""}`;
}
// detail style: 11:21 PM · Oct 14, 2026
export function fullDate(iso) {
	const d = new Date(iso);
	const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	return `${t} · ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
export const joined = (iso) => {
	const d = new Date(iso);
	return `Joined ${d.toLocaleString([], { month: "long" })} ${d.getFullYear()}`;
};

// Turn post text into markup: links, @mentions (with federated @name@host), #tags
const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])|(^|[^\w@/])@(\w{1,50}(?:@(?:[a-z0-9-]+\.)+[a-z0-9-]+)?)|(^|[^\w&/])#(\w+)/gi;
export function richText(text) {
	let out = "", last = 0;
	text = String(text ?? "");
	for (const m of text.matchAll(TOKEN)) {
		out += esc(text.slice(last, m.index));
		if (m[1]) {
			const shown = m[1].replace(/^https?:\/\/(www\.)?/, "");
			out += `<a class="lnk" href="${esc(m[1])}" target="_blank" rel="noopener noreferrer">${esc(shown.length > 32 ? shown.slice(0, 31) + "…" : shown)}</a>`;
		} else if (m[3]) {
			out += esc(m[2]) + `<a class="lnk" data-user="${esc(m[3])}">@${esc(m[3])}</a>`;
		} else {
			out += esc(m[4]) + `<a class="lnk" data-tag="${esc(m[5])}">#${esc(m[5])}</a>`;
		}
		last = m.index + m[0].length;
	}
	return out + esc(text.slice(last));
}

export const host = (url) => {
	try { return new URL(url).host; } catch { return ""; }
};

// Normalise what someone typed as an instance: "https://X.Org/" -> "x.org"
export function normaliseInstance(s) {
	s = String(s ?? "").trim().toLowerCase();
	if (!s) return "";
	if (!/^https?:\/\//.test(s)) s = "https://" + s;
	try {
		const u = new URL(s);
		return u.host;
	} catch {
		return "";
	}
}

export function haptic(ms = 8) {
	try { navigator.vibrate?.(ms); } catch {}
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms) {
	let t;
	return (...a) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...a), ms);
	};
}

// rAF-throttled handler, for scroll
export function rafThrottle(fn) {
	let queued = false, lastArgs;
	return (...a) => {
		lastArgs = a;
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			fn(...lastArgs);
		});
	};
}

// default avatar when none is set
export const DEFAULT_AVATAR = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#3e4144"/><circle cx="20" cy="15" r="7" fill="#8b98a5"/><path d="M6 36c2-8 8-11 14-11s12 3 14 11" fill="#8b98a5"/></svg>`);
export const avatar = (u, cls = "av") => `<img class="${cls}" src="${esc(u?.avatar_url || DEFAULT_AVATAR)}" alt="" loading="lazy" decoding="async" onerror="this.src='${DEFAULT_AVATAR}'">`;

export function verifiedBadge(u) {
	const t = (u?.verified_type || "").toLowerCase();
	if (!t) return "";
	const cls = t.includes("business") || t.includes("gold") || t.includes("org") ? "gold" : t.includes("gov") || t.includes("grey") || t.includes("gray") ? "grey" : "blue";
	return `<svg class="vf ${cls}" aria-label="Verified"><use href="#i-verified"/></svg>`;
}
export const isRemote = (u) => String(u?.screen_name ?? "").includes("@");
export const handleOf = (u) => "@" + (u?.screen_name ?? "");

export function pressable(node) {
	// iOS-like active highlight without :active lag
	node.addEventListener("pointerdown", (e) => {
		const t = e.target.closest(".press");
		if (!t) return;
		t.classList.add("pressed");
		const up = () => {
			setTimeout(() => t.classList.remove("pressed"), 90);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
		};
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
	}, { passive: true });
}
