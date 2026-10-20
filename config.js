// Deployment settings. Optional: the app works without editing this file.
//
// oauthClients: OAuth client IDs you registered for this PWA on each instance
// (at https://<instance>/account/apps/developer, with the redirect URL set to
// the exact address this app is served from: https://mobile.xitter.space/ for the official one).
// With an entry here, people on that instance just tap "Continue in browser".
// Without one, they can paste their own client ID or a personal API token.
window.XITTER_CONFIG = {
	oauthClients: {
		// "larp.jye.fyi": "1234567890123456789",
	},
	// Where the federation list is read from; falls back to the built-in copy.
	instancesUrl: "https://raw.githubusercontent.com/Xittered/xitter/main/instances.json",
};
