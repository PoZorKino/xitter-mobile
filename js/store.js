// Signed-in accounts (each one a handle on one instance), the active one, and
// preferences. Kept in localStorage for a synchronous start, and mirrored into
// IndexedDB so the service worker can check notifications for every account.

const KEY = "xit.accounts";
const ACTIVE = "xit.active";
const PREFS = "xit.prefs";

const read = (k, fallback) => {
	try {
		const v = localStorage.getItem(k);
		return v ? JSON.parse(v) : fallback;
	} catch {
		return fallback;
	}
};
const write = (k, v) => {
	try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

const listeners = new Set();
export const onAccountsChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => {
	for (const fn of listeners) fn();
	self.XNotify?.saveAccounts(accounts());
};

export const accountKey = (screenName, instance) => `${String(screenName).toLowerCase()}@${instance}`;

export function accounts() {
	return read(KEY, []);
}
export function account(key) {
	return accounts().find((a) => a.key === key);
}
export function activeAccount() {
	const list = accounts();
	const k = read(ACTIVE, null);
	return list.find((a) => a.key === k) ?? list[0];
}
export function setActive(key) {
	write(ACTIVE, key);
	emit();
}
export function saveAccount(a) {
	const list = accounts().filter((x) => x.key !== a.key);
	list.push(a);
	write(KEY, list);
	emit();
}
export function updateAccount(key, patch) {
	const list = accounts().map((a) => (a.key === key ? { ...a, ...patch } : a));
	write(KEY, list);
	emit();
}
export function removeAccount(key) {
	write(KEY, accounts().filter((a) => a.key !== key));
	if (read(ACTIVE, null) === key) write(ACTIVE, accounts()[0]?.key ?? null);
	try {
		for (const k of Object.keys(localStorage)) if (k.startsWith(`xit.cache.${key}.`)) localStorage.removeItem(k);
	} catch {}
	self.XNotify?.forget(key);
	emit();
}

export function prefs() {
	return { theme: "system", autoplay: true, notifyAll: true, ...read(PREFS, {}) };
}
export function setPref(k, v) {
	write(PREFS, { ...prefs(), [k]: v });
	applyTheme();
}
export function applyTheme() {
	const t = prefs().theme;
	const dark = t === "dim" || t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
	const theme = t === "system" ? (dark ? "dark" : "light") : t;
	document.documentElement.dataset.theme = theme;
	document.documentElement.dataset.autoplay = prefs().autoplay ? "on" : "off";
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.content = theme === "light" ? "#ffffff" : theme === "dim" ? "#15202b" : "#000000";
}

// small per-account snapshots so screens paint instantly on launch
export function cacheGet(key, name) {
	return read(`xit.cache.${key}.${name}`, null);
}
export function cacheSet(key, name, value) {
	try {
		localStorage.setItem(`xit.cache.${key}.${name}`, JSON.stringify(value));
	} catch {
		// quota: drop every snapshot and try once more
		try {
			for (const k of Object.keys(localStorage)) if (k.startsWith("xit.cache.")) localStorage.removeItem(k);
			localStorage.setItem(`xit.cache.${key}.${name}`, JSON.stringify(value));
		} catch {}
	}
}
