// The composer: a full-height sheet for a post, reply, quote or thread, with
// photos and videos uploading while you type.

import { sheet, toast } from "./nav.js";
import { $, $$, avatar, el, esc, haptic, icon, richText } from "./util.js";

const LIMIT = 280;
const draftKey = (key) => `xit.draft.${key}`;

export function compose(ctx, { replyTo, quote, text = "" } = {}) {
	const { api, account } = ctx;
	const saved = !replyTo && !quote && !text ? (() => {
		try {
			return JSON.parse(localStorage.getItem(draftKey(account.key)) || "null");
		} catch {
			return null;
		}
	})() : null;
	// a thread is a list of parts; each part has text and media
	const parts = (saved?.length ? saved : [{ text }]).map((p) => ({ text: p.text || "", media: [] }));
	let active = 0;
	let sending = false;
	let parent = replyTo?.id, firstPost = null, postedCount = 0;

	const root = el(`<div class="compose">
		<div class="compose-bar"><button class="text-btn" data-cancel>Cancel</button><span class="compose-acct">${account.instance}</span><button class="pill-btn solid" data-send disabled>${replyTo ? "Reply" : "Post"}</button></div>
		<div class="compose-scroll sheet-scroll">
			${replyTo ? `<div class="compose-context"><div class="cc-left">${avatar(replyTo.author, "av sm")}<i class="cc-line"></i></div><div class="cc-body"><div class="cc-name"><b>${esc(replyTo.author.name || replyTo.author.screen_name)}</b> <span>@${esc(replyTo.author.screen_name)}</span></div><div class="cc-text">${richText(replyTo.text || "")}</div><div class="cc-to">Replying to <span class="accent-text">@${esc(replyTo.author.screen_name)}</span></div></div></div>` : ""}
			<div class="parts"></div>
			${quote ? `<div class="compose-quote"><div class="quote"><div class="quote-head">${avatar(quote.author, "av xs")}<b>${esc(quote.author.name || quote.author.screen_name)}</b> <span class="handle">@${esc(quote.author.screen_name)}</span></div><div class="text">${richText(quote.text || "")}</div></div></div>` : ""}
		</div>
		<div class="compose-tools no-drag">
			<label class="tool">${icon("image")}<input type="file" accept="image/*,video/*" multiple hidden></label>
			<span class="who-can">${icon("globe")} Everyone can reply</span>
			<span class="tools-end"><svg class="ring" viewBox="0 0 30 30"><circle cx="15" cy="15" r="12" class="ring-bg"/><circle cx="15" cy="15" r="12" class="ring-fg" stroke-dasharray="75.4" stroke-dashoffset="75.4"/></svg><span class="ring-n"></span>${replyTo || quote ? "" : `<i class="tool-sep"></i><button class="tool add-part" aria-label="Add to thread">${icon("plus")}</button>`}</span>
		</div>
	</div>`);

	const s = sheet(root, { full: true, className: "compose-sheet", onClose: () => {
		saveDraft();
		vv?.removeEventListener("resize", onViewport);
		vv?.removeEventListener("scroll", onViewport);
	} });
	// keep the toolbar above the on-screen keyboard (iOS overlays it)
	const vv = window.visualViewport;
	const onViewport = () => {
		const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
		s.wrap.style.setProperty("--kb", kb + "px");
	};
	vv?.addEventListener("resize", onViewport);
	vv?.addEventListener("scroll", onViewport);
	const partsEl = $(".parts", root);
	const send = $("[data-send]", root);

	function renderParts() {
		partsEl.innerHTML = parts
			.map((p, i) => `<div class="part ${i === active ? "active" : ""}" data-i="${i}">
				<div class="part-left">${avatar(account.user, "av")}${i < parts.length - 1 ? `<i class="part-line"></i>` : ""}</div>
				<div class="part-body">
					<textarea rows="1" placeholder="${i === 0 ? (replyTo ? "Post your reply" : "What's happening?") : "Add another post"}" maxlength="25000">${esc(p.text)}</textarea>
					<div class="part-media n${p.media.length}">${p.media.map((m, j) => `<div class="pm" data-j="${j}">${m.kind === "video" ? `<video src="${m.preview}" muted playsinline></video>` : `<img src="${m.preview}" alt="">`}<button class="pm-x" data-rm="${j}">${icon("close")}</button>${m.id ? "" : `<div class="pm-progress"><i style="transform:scaleX(${m.progress || 0})"></i></div>`}${m.error ? `<div class="pm-error">${esc(m.error)}</div>` : ""}</div>`).join("")}</div>
				</div>
				${parts.length > 1 ? `<button class="part-x" data-rmpart="${i}" aria-label="Remove">${icon("close")}</button>` : ""}
			</div>`)
			.join("");
		for (const ta of $$("textarea", partsEl)) grow(ta);
		update();
	}
	const grow = (ta) => {
		ta.style.height = "auto";
		ta.style.height = ta.scrollHeight + "px";
	};
	function update() {
		const p = parts[active];
		const n = [...(p.text || "")].length;
		const ring = $(".ring-fg", root), label = $(".ring-n", root);
		const frac = Math.min(1, n / LIMIT);
		ring.style.strokeDashoffset = String(75.4 * (1 - frac));
		root.classList.toggle("near", LIMIT - n <= 20 && n <= LIMIT);
		root.classList.toggle("over", n > LIMIT);
		label.textContent = LIMIT - n <= 20 ? String(LIMIT - n) : "";
		$(".ring", root).style.visibility = n ? "visible" : "hidden";
		const ok = parts.every((x) => (x.text.trim() || x.media.length || (quote && parts.length === 1)) && x.media.every((m) => m.id && !m.error));
		send.disabled = !ok || sending;
		const addPart = $(".add-part", root);
		if (addPart) addPart.disabled = !p.text.trim() || parts.length >= 25;
	}
	function saveDraft() {
		if (replyTo || quote || sending === "done") return;
		try {
			if (parts.some((p) => p.text.trim())) localStorage.setItem(draftKey(account.key), JSON.stringify(parts.map((p) => ({ text: p.text }))));
			else localStorage.removeItem(draftKey(account.key));
		} catch {}
	}

	partsEl.addEventListener("input", (e) => {
		const ta = e.target.closest("textarea");
		if (!ta) return;
		const i = Number(ta.closest(".part").dataset.i);
		parts[i].text = ta.value;
		grow(ta);
		update();
	});
	partsEl.addEventListener("focusin", (e) => {
		const part = e.target.closest(".part");
		if (!part) return;
		active = Number(part.dataset.i);
		$$(".part", partsEl).forEach((x) => x.classList.toggle("active", x === part));
		update();
	});
	partsEl.addEventListener("click", (e) => {
		const rm = e.target.closest("[data-rm]");
		if (rm) {
			const i = Number(rm.closest(".part").dataset.i);
			parts[i].media.splice(Number(rm.dataset.rm), 1);
			return renderParts();
		}
		const rp = e.target.closest("[data-rmpart]");
		if (rp) {
			parts.splice(Number(rp.dataset.rmpart), 1);
			active = Math.min(active, parts.length - 1);
			renderParts();
		}
	});
	$(".add-part", root)?.addEventListener("click", () => {
		parts.push({ text: "", media: [] });
		active = parts.length - 1;
		renderParts();
		$$("textarea", partsEl)[active]?.focus();
	});

	$("input[type=file]", root).addEventListener("change", (e) => {
		const files = [...e.target.files];
		e.target.value = "";
		const p = parts[active];
		for (const file of files) {
			if (p.media.length >= 4) {
				toast("You can add up to 4 photos or videos", { error: true });
				break;
			}
			const m = { kind: file.type.startsWith("video/") ? "video" : "image", preview: URL.createObjectURL(file), progress: 0 };
			p.media.push(m);
			api.upload(file, (x) => {
				m.progress = x;
				const bar = partsEl.querySelector(`.part[data-i="${parts.indexOf(p)}"] .pm[data-j="${p.media.indexOf(m)}"] .pm-progress i`);
				if (bar) bar.style.transform = `scaleX(${x})`;
			}).then(
				(id) => {
					m.id = id;
					renderParts();
				},
				(err) => {
					m.error = err.message;
					renderParts();
				},
			);
		}
		renderParts();
	});

	$("[data-cancel]", root).onclick = () => s.close();
	send.onclick = async () => {
		if (send.disabled) return;
		sending = true;
		update();
		send.innerHTML = `<span class="mini-spin"></span>`;
		haptic(10);
		const total = parts.length + postedCount;
		try {
			while (parts.length) {
				const p = parts[0];
				const post = await api.createPost({
					text: p.text,
					...(parent ? { reply_to: parent } : {}),
					...(!firstPost && quote ? { quote: quote.id } : {}),
					...(p.media.length ? { media_ids: p.media.map((m) => m.id) } : {}),
				});
				firstPost ??= post;
				parent = post.id;
				// a posted part leaves the composer, so a failure later only retries the rest
				parts.shift();
				postedCount++;
			}
			sending = "done";
			try {
				localStorage.removeItem(draftKey(account.key));
			} catch {}
			s.close();
			ctx.posted?.(firstPost, { replyTo });
			toast(replyTo ? "Your reply was sent" : total > 1 ? "Your thread was sent" : "Your post was sent");
		} catch (err) {
			sending = false;
			send.textContent = replyTo ? "Reply" : "Post";
			active = 0;
			renderParts();
			toast(err.message, { error: true });
		}
	};

	renderParts();
	requestAnimationFrame(() => {
		const ta = $$("textarea", partsEl)[active];
		ta?.focus();
		ta?.setSelectionRange(ta.value.length, ta.value.length);
	});
}
