// Deployment settings. Optional: the app works without editing this file.
//
// oauthClients: OAuth client IDs you registered for this PWA on each instance
// (at https://<instance>/account/apps/developer, with the redirect URL set to
// the exact address this app is served from: https://mobile.xitter.space/ for the official one).
// With an entry here, people on that instance just tap "Continue in browser".
// Without one, they can paste their own client ID or a personal API token.
window.XITTER_CONFIG = {
	// The address these client IDs were registered with as their redirect URL.
	// Served from anywhere else, the app ignores them (they'd be refused).
	oauthRedirect: "https://mobile.xitter.space/",
	// This app's client ID metadata document. Instances that support them
	// (/.well-known/oauth-authorization-server says so) need no registration:
	// sign-in there is one tap without an entry in oauthClients.
	clientMetadata: "https://mobile.xitter.space/oauth-client.json",
	oauthClients: {
		"xitter.space": "2112657172314718208",
		"jr1.xitter.space": "2113020195218915328",
	},
	// An instance to offer first: the welcome screen then shows one big
	// "Continue with <instance>" button. It needs an entry in oauthClients.
	primaryInstance: "xitter.space",
	// Where the federation list is read from; falls back to the built-in copy.
	instancesUrl: "https://raw.githubusercontent.com/Xittered/xitter/main/instances.json",
};
