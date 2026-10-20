// Adding accounts: pick an instance, then sign in with OAuth (PKCE) or paste
// a personal API token. Each account is a handle on one instance; there can be
// any number of them, on any mix of instances.

import { originOf, whoAmI } from "./api.js";
import { sheet, toast } from "./nav.js";
import { accountKey, saveAccount, setActive } from "./store.js";
import { $, el, esc, icon, normaliseInstance } from "./util.js";

const CFG = window.XITTER_CONFIG || {};
const CLIENTS = "xit.clients";
const PENDING = "xit.oauth";

// the federation list, bundled so the picker works offline; refreshed from GitHub
const BUILTIN = [
	["larp.jye.fyi", "larp"],
	["nidus.fourteentrees.net", "Nidus"],
	["social.opsex.best", "Xitter"],
	["x.glitchprod.xyz", "Digital Circus"],
	["x.transfur.org", "Xitter"],
	["xit.chococat.lol", "Xit"],
	["xitter.opuadm.com", "Xitter"],
	["xt.iambrdn.com", "xt.brdn"],
].map(([id, name]) => ({ id, name }));

async function instances() {
	try {
		const cached = JSON.parse(localStorage.getItem("xit.instances") || "null");
		if (cached && Date.now() - cached.at < 864e5) return cached.list;
	} catch {}
	try {
		const res = await fetch(CFG.instancesUrl, { cache: "no-store" });
		const j = await res.json();
		const list = j.instances.filter((i) => i.state === "active").map((i) => ({ id: i.id, name: i.name }));
		localStorage.setItem("xit.instances", JSON.stringify({ at: Date.now(), list }));
		return list;
	} catch {
		return BUILTIN;
	}
}

export const redirectUri = () => new URL("./", location.href).href;

function clientFor(instance) {
	try {
		return JSON.parse(localStorage.getItem(CLIENTS) || "{}")[instance] || CFG.oauthClients?.[instance] || "";
	} catch {
		return CFG.oauthClients?.[instance] || "";
	}
}
function rememberClient(instance, id) {
	try {
		const all = JSON.parse(localStorage.getItem(CLIENTS) || "{}");
		all[instance] = id;
		localStorage.setItem(CLIENTS, JSON.stringify(all));
	} catch {}
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function startOAuth(instance, clientId) {
	const verifier = random(48); // 64 chars
	const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
	const state = random(18);
	const redirect = redirectUri();
	localStorage.setItem(PENDING, JSON.stringify({ instance, clientId, verifier, state, redirect, at: Date.now() }));
	const u = new URL(`${originOf(instance)}/oauth/authorize`);
	u.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, scope: "write", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
	location.href = u.toString();
}

// on launch: finish a sign-in that came back with ?code=
export async function finishOAuth() {
	const q = new URLSearchParams(location.search);
	if (!q.has("state") || (!q.has("code") && !q.has("error"))) return null;
	history.replaceState(null, "", location.pathname + location.hash);
	let pending;
	try {
		pending = JSON.parse(localStorage.getItem(PENDING) || "null");
	} catch {}
	localStorage.removeItem(PENDING);
	if (!pending || pending.state !== q.get("state")) throw new Error("That sign-in link expired. Try again.");
	if (q.get("error")) throw new Error(q.get("error") === "access_denied" ? "Sign-in was cancelled." : `Sign-in failed (${q.get("error")}).`);
	const res = await fetch(`${originOf(pending.instance)}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "authorization_code", code: q.get("code"), client_id: pending.clientId, redirect_uri: pending.redirect, code_verifier: pending.verifier }),
	});
	const out = await res.json().catch(() => ({}));
	if (!res.ok || !out.access_token) throw new Error(out.error === "invalid_grant" ? "The sign-in code was refused. Try again." : `Sign-in failed (${out.error || res.status}).`);
	const user = await whoAmI(pending.instance, out.access_token);
	const acct = { key: accountKey(user.screen_name, pending.instance), instance: pending.instance, token: out.access_token, scope: out.scope, expiresAt: Date.now() + out.expires_in * 1000, method: "oauth", clientId: pending.clientId, user, addedAt: Date.now() };
	saveAccount(acct);
	setActive(acct.key);
	return acct;
}

// re-run OAuth for an account whose token expired
export function reauthorize(account) {
	const id = account.clientId || clientFor(account.instance);
	if (id) return startOAuth(account.instance, id);
	return addAccountFlow({ instance: account.instance });
}

// ---- the add-account sheet

export function addAccountFlow({ onDone, instance: preset, welcome = false } = {}) {
	const root = el(`<div class="auth">
		<div class="auth-bar"><button class="bar-btn press" data-x aria-label="Close">${icon("close")}</button><div class="auth-logo">${icon("logo")}</div><span></span></div>
		<div class="auth-body sheet-scroll"></div></div>`);
	const s = sheet(root, { full: true, className: "auth-sheet" });
	$("[data-x]", root).onclick = () => s.close();
	const body = $(".auth-body", root);

	function pick() {
		body.innerHTML = `<h1>${welcome ? "Sign in to Xitter" : "Add an account"}</h1>
			<p class="auth-sub">Pick the instance your account lives on. You can add accounts from as many instances as you like and switch between them.</p>
			<form class="field-wrap" data-custom><input class="field" name="i" placeholder="Instance address, e.g. larp.jye.fyi" autocapitalize="off" autocomplete="url" inputmode="url" enterkeyhint="go"><button class="pill-btn solid" type="submit">Next</button></form>
			<div class="group-label">Federated instances</div>
			<div class="group inst-list"><div class="loading-row">Loading…</div></div>`;
		$("[data-custom]", body).onsubmit = (e) => {
			e.preventDefault();
			const i = normaliseInstance(e.target.i.value);
			if (!i) return toast("Enter an instance address", { error: true });
			method(i);
		};
		instances().then((list) => {
			$(".inst-list", body).innerHTML = list
				.map((i) => `<button class="row press" data-i="${esc(i.id)}"><img class="inst-ico" src="${esc(originOf(i.id))}/favicon.ico" alt="" onerror="this.style.visibility='hidden'"><div class="row-main"><b>${esc(i.name)}</b><span>${esc(i.id)}</span></div>${icon("back", "flip dim")}</button>`)
				.join("");
		});
		body.onclick = (e) => {
			const b = e.target.closest("[data-i]");
			if (b) method(b.dataset.i);
		};
	}

	function method(instance) {
		const origin = originOf(instance);
		const cid = clientFor(instance);
		body.onclick = null;
		body.innerHTML = `<button class="text-btn back-link" data-back>${icon("back")} Instances</button>
			<h1>Sign in to ${esc(instance)}</h1>
			<p class="auth-sub">Your account and posts stay on ${esc(instance)}. This app talks to it directly, from your device.</p>
			<div class="auth-card">
				<b>Continue in browser</b>
				<p>Approve this app on ${esc(instance)} with OAuth. Access lasts 30 days.</p>
				<p class="fine">If ${esc(instance)} answers “Invalid authorization form.”, it's running a Xitter version with a sign-in bug. Use an API token below instead.</p>
				${cid ? `<button class="pill-btn solid wide" data-oauth>Continue in browser</button>` : `<details><summary>Set up browser sign-in (once per instance)</summary>
					<ol class="steps"><li>Open <a href="${esc(origin)}/account/apps/developer" target="_blank" rel="noopener">Developer apps</a> on ${esc(instance)}.</li>
					<li>Register an app with this exact redirect URL: <code class="copy" data-copy="${esc(redirectUri())}">${esc(redirectUri())}</code></li>
					<li>Paste its Client ID here:</li></ol>
					<form class="field-wrap" data-cid><input class="field" name="cid" placeholder="Client ID" inputmode="numeric" autocomplete="off"><button class="pill-btn solid" type="submit">Continue</button></form></details>`}
			</div>
			<div class="auth-or"><span>or</span></div>
			<div class="auth-card">
				<b>Use an API token</b>
				<p>Doesn't expire until you revoke it.</p>
				<ol class="steps"><li><a href="${esc(origin)}/account/api" target="_blank" rel="noopener">Open API tokens on ${esc(instance)}</a> and sign in if asked.</li>
				<li>Make a token with <b>Read and write</b> access.</li>
				<li>Paste it here:</li></ol>
				<form class="field-wrap" data-token><input class="field mono" name="t" placeholder="xit_…" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="pill-btn solid" type="submit">Sign in</button></form>
			</div>`;
		$("[data-back]", body).onclick = pick;
		$("[data-oauth]", body)?.addEventListener("click", () => startOAuth(instance, cid));
		$("[data-cid]", body)?.addEventListener("submit", (e) => {
			e.preventDefault();
			const id = e.target.cid.value.trim();
			if (!/^\d{1,19}$/.test(id)) return toast("A client ID is a number", { error: true });
			rememberClient(instance, id);
			startOAuth(instance, id);
		});
		body.querySelector("[data-copy]")?.addEventListener("click", (e) => navigator.clipboard?.writeText(e.target.dataset.copy).then(() => toast("Copied")));
		$("[data-token]", body).onsubmit = async (e) => {
			e.preventDefault();
			const token = e.target.t.value.trim();
			if (!/^xit_[0-9a-f]{48}$/i.test(token)) return toast("That doesn't look like a Xitter token (xit_ and 48 characters)", { error: true });
			const btn = e.target.querySelector("button");
			btn.disabled = true;
			btn.innerHTML = `<span class="mini-spin"></span>`;
			try {
				const user = await whoAmI(instance, token);
				const acct = { key: accountKey(user.screen_name, instance), instance, token, method: "token", user, addedAt: Date.now() };
				saveAccount(acct);
				s.close();
				onDone?.(acct);
			} catch (err) {
				toast(err.message, { error: true });
				btn.disabled = false;
				btn.textContent = "Sign in";
			}
		};
	}

	if (preset) method(preset);
	else pick();
	return s;
}

// first launch, no accounts yet
export function welcomeScreen(onDone) {
	const w = el(`<div class="welcome">
		<div class="welcome-logo">${icon("logo")}</div>
		<h1>See what's happening across the Xitterverse.</h1>
		<div class="welcome-actions">
			<button class="pill-btn solid wide big" data-signin>Sign in</button>
			<p class="fine">Works with any Xitter instance. Add accounts from several instances and switch between them with a tap.</p>
		</div>
	</div>`);
	$("[data-signin]", w).onclick = () => addAccountFlow({ welcome: true, onDone });
	return w;
}
