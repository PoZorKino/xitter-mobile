# Xitter PWA

An installable, X-for-iOS-style client for [Xitter](https://github.com/Xittered/xitter) instances.
No build step, no framework, no server of its own: static files that talk straight to each
instance's public API (`/api/v1`).

## What it does

- **Several accounts on several instances.** Sign in as `@jye` on one instance and `@squid` on
  another, then switch with a tap. Each account keeps its own tabs, scroll positions and
  open pages, so switching back is instant.
  - Long-press your avatar (tab bar or top left) to open the account switcher
  - Or tap the top-left avatar for the drawer; your other accounts sit in its top-right corner
- **Feels like the iOS app:** stacked navigation that slides in over a dimmed, parallaxed page;
  swipe from the left edge to go back, and the page follows your finger. Card-style composer,
  action sheets you can drag down, photos that grow out of their thumbnail and drag down to
  close, a stretchy profile banner, a top bar that hides as you scroll, pull to refresh, a
  "new posts" pill, a heart burst when you like something, haptics where the device has them.
  Light, Dim and Lights out themes.
- **Fast:** about 190 KB of plain ES modules and CSS (about 50 KB gzipped) with modulepreload, the app shell cached by a
  service worker, the home timeline restored from a snapshot before the network answers,
  `content-visibility` on posts, one shared request per URL, and optimistic likes, reposts,
  bookmarks and follows.
- **Notifications** for replies, mentions, new followers, likes and reposts, on every
  account: unread badges in the tab bar, the switcher and the app icon, an in-app banner when
  another account gets something (tap it to switch), and system notifications.
- Home timeline, Explore (latest and popular across the federation), threads, profiles
  (posts, replies, media), followers/following, search for posts and people with Xitter's
  operators, and composing posts, replies, quotes and threads with up to 4 photos or videos
  each (large videos upload in chunks).

## Signing in

On instances listed in `config.js`, sign-in is one tap: the app opens the instance's
Authorize page, and if you're already signed in there you tap Authorize and you're back in.
The official app (https://mobile.xitter.space/) has this for **xitter.space**, which the
welcome screen offers first.

Instances that support OAuth client ID metadata documents (proposed for Xitter in
[jyeridley/xitter2 one-tap-oauth](https://github.com/jyeridley/xitter2/tree/one-tap-oauth))
need no registration at all: the app identifies itself with
[`oauth-client.json`](oauth-client.json) and sign-in is one tap there too.

On each instance you can sign in either way:

1. **API token** (works everywhere, no setup): open `https://<instance>/account/api`, make a
   *Read and write* token and paste it in. It lasts until you revoke it.
2. **OAuth with PKCE** ("Continue in browser"): needs an OAuth client registered on that
   instance at `https://<instance>/account/apps/developer`, with the redirect URL set to the
   exact address the app is served from (`https://mobile.xitter.space/` for the official one). Put the client
   IDs in `config.js` so people just tap the button, or anyone can paste a client ID in the
   app. Xitter's OAuth tokens expire after 30 days; the app asks you to sign in again then.
   Current Xitter rejects every OAuth approval with "Invalid authorization form." (its consent page
   is served with `Referrer-Policy: no-referrer`, so the form posts `Origin: null`); the fix is a
   one-line change in `src/oauth.ts`. Until an instance has it, sign in there with a token.

## Notifications: what to know

Xitter's public API has no notifications endpoint, and the instance's Web Push is tied to its
own web client's session. So this app works notifications out itself (`js/notify-core.js`):
a search for `to:you OR @you` (replies and mentions), the follower list compared with the
last look (new followers), and the counts on your recent posts compared with the last look
(new likes and reposts). Because of that:

- Likes and reposts show as "3 new likes on your post", without who.
- Checks run every 45 s for the account you're using and every 2 min for the others,
  **while the app is open**. On installed Chromium apps (Android, desktop) Periodic
  Background Sync checks in the background too, about every 15 minutes or as often as the
  browser allows. iOS gives web apps no background time, so on an iPhone you get alerts
  when you open the app, not while it's closed.

Real push for closed apps needs the server to offer it: a notifications endpoint and Web Push
subscriptions for API tokens would let this app use it directly.

## Running it

Live at **https://mobile.xitter.space/**, built from `main`. For OAuth sign-in, register `https://mobile.xitter.space/` as the redirect URL on each instance.

Serve the folder over HTTPS from any static host (GitHub Pages, Cloudflare Pages, Netlify,
nginx...). Locally:

```sh
npx http-server -p 8080 -c-1
```

`http://localhost` counts as secure, so the service worker works there. Instances on
`localhost`/`127.0.0.1` are reached over plain HTTP, for testing against a local Xitter.

On iPhone: open it in Safari → Share → Add to Home Screen. Notifications on iOS only work
once it's installed that way.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Shell, icon sprite |
| `config.js` | Optional OAuth client IDs per instance |
| `sw.js` | Offline shell, media cache, background notification checks, notification taps |
| `js/app.js` | Account roots, tab bar, drawer, account switcher |
| `js/nav.js` | Stacks, push/pop, edge swipe, sheets, banners, back button |
| `js/api.js` | `/api/v1` client, shared post cache, uploads |
| `js/post.js` | Post rendering, actions, feeds with paging and pull to refresh |
| `js/pages.js` | Home, Explore, post, profile, follows, search, settings |
| `js/notifications.js`, `js/notify-core.js` | Notifications tab and the checker |
| `js/compose.js` | Composer |
| `js/media.js` | Media viewer |
| `js/auth.js` | Adding accounts: instance picker, token, OAuth PKCE |
