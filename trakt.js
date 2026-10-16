var traktKeys = require("./trakt_keys.js");
var apiGateModule = require("./trakt-api-gate.js");

var API_ROOT = "https://api.trakt.tv";
var DEVICE_CODE_PATH = "/oauth/device/code";
var DEVICE_TOKEN_PATH = "/oauth/device/token";
var TOKEN_PATH = "/oauth/token";
var USER_SETTINGS_PATH = "/users/settings";
var TOKEN_FALLBACK_PATH = "@data/trakt-token.json";
var CACHE_PATH = "@data/trakt-cache.json";
var KEYCHAIN_SERVICE = "io.github.olivergiangvu.iinatraktscrobblerplus";
var KEYCHAIN_ACCOUNT = "trakt-oauth";
var AUTH_COOLDOWN_MS = 30000;
var TOKEN_REFRESH_MARGIN_SECONDS = 60;
var SEARCH_SCORE_THRESHOLD = 5;
var PROFILE_CACHE_TTL_MS = 15 * 60 * 1000;
var HISTORY_CACHE_TTL_MS = 3 * 60 * 1000;
var HISTORY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
var HISTORY_LIMIT = 12;
var AUTH_REQUIRED_ERROR = "Trakt authorization required";

var runtime = {
	file: null,
	preferences: null,
	utils: null,
	logger: function () {},
	notify: function () {},
	tokenCache: undefined,
	tokenRefreshPromise: null,
	searchCache: null,
	authPromise: null,
	authPrompt: "",
	authCode: "",
	authUrl: "",
	lastAuthFailureAt: 0,
	lastAuthFailureMessage: "",
	loggedCredentialMode: false,
	apiGate: null,
	viewerProfile: null,
	viewerProfileFetchedAt: 0,
	recentHistory: null,
	recentHistoryFetchedAt: 0,
};

function configure(options) {
	var settings = options || {};
	if (settings.file) {
		runtime.file = settings.file;
		if (!runtime.apiGate) runtime.apiGate = apiGateModule.create({file: settings.file});
	}
	if (settings.preferences)
		runtime.preferences = settings.preferences;
	if (settings.utils) runtime.utils = settings.utils;
	if (settings.apiGate) runtime.apiGate = settings.apiGate;
	if (typeof settings.logger === "function")
		runtime.logger = settings.logger;
	if (typeof settings.notify === "function")
		runtime.notify = settings.notify;
}

function log(message) {
	runtime.logger(String(message || ""));
}

function notify(message) {
	runtime.notify(String(message || ""));
}

function pref(key, fallbackValue) {
	if (!runtime.preferences) return fallbackValue;
	var value = runtime.preferences.get(key);
	return value === undefined || value === null
		? fallbackValue
		: value;
}

function nowSeconds() {
	return Math.floor(Date.now() / 1000);
}

function sleep(ms) {
	return new Promise(function (resolve) {
		setTimeout(resolve, ms);
	});
}

function readJson(path, fallbackValue) {
	if (!runtime.file || !runtime.file.exists(path)) {
		return fallbackValue;
	}

	try {
		return JSON.parse(runtime.file.read(path) || "null");
	} catch (_error) {
		return fallbackValue;
	}
}

function writeJson(path, value) {
	if (!runtime.file) return;
	runtime.file.write(path, JSON.stringify(value, null, 2));
}

function getClientId() {
	return String(pref("trakt_client_id", "") || "").trim() || traktKeys.getId();
}

function getClientSecret() {
	return String(pref("trakt_client_secret", "") || "").trim() || traktKeys.getSecret();
}

function hasCredentials() {
	return !!(getClientId() && getClientSecret());
}

function usingEmbeddedCredentials() {
	return !(
		String(pref("trakt_client_id", "") || "").trim() &&
		String(pref("trakt_client_secret", "") || "").trim()
	) && traktKeys.hasEmbeddedCredentials();
}

function credentialMode() {
	if (usingEmbeddedCredentials()) return "bundled";
	if (hasCredentials()) return "override";
	return "missing";
}

function createAuthStatus(state, summary, detail, busy, extras) {
	var status = {
		state: state,
		summary: summary,
		detail: detail || "",
		busy: !!busy,
		connected: state === "connected",
		credentialMode: credentialMode(),
	};

	Object.keys(extras || {}).forEach(function (key) {
		status[key] = extras[key];
	});

	return status;
}

function createAuthRequiredError() {
	return new Error(AUTH_REQUIRED_ERROR);
}

function isAuthRequiredError(error) {
	return (
		!!error && String(error.message || error) === AUTH_REQUIRED_ERROR
	);
}

function clearViewerProfileCache() {
	runtime.viewerProfile = null;
	runtime.viewerProfileFetchedAt = 0;
}

function clearRecentHistoryCache() {
	runtime.recentHistory = null;
	runtime.recentHistoryFetchedAt = 0;
}

function getTokenInfo() {
	var token = loadToken();
	if (!token || !token.access_token) {
		return null;
	}

	var createdAtSeconds = Number(token.created_at || 0);
	var expiresInSeconds = Number(token.expires_in || 0);
	var createdAtMs =
		createdAtSeconds > 0 ? createdAtSeconds * 1000 : 0;
	var expiresAtMs =
		createdAtMs && expiresInSeconds
			? createdAtMs + expiresInSeconds * 1000
			: 0;
	var remainingSeconds = expiresAtMs
		? Math.floor((expiresAtMs - Date.now()) / 1000)
		: 0;

	return {
		createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : "",
		expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : "",
		expiresInSeconds: remainingSeconds,
		expired: isTokenExpired(token),
	};
}

function readTokenFromKeychain() {
	if (
		!runtime.utils ||
		typeof runtime.utils.keyChainRead !== "function"
	) {
		return "";
	}

	try {
		return (
			runtime.utils.keyChainRead(
				KEYCHAIN_SERVICE,
				KEYCHAIN_ACCOUNT,
			) || ""
		);
	} catch (_error) {
		return "";
	}
}

function writeTokenToKeychain(rawValue) {
	if (
		!runtime.utils ||
		typeof runtime.utils.keyChainWrite !== "function"
	) {
		return false;
	}

	try {
		return runtime.utils.keyChainWrite(
			KEYCHAIN_SERVICE,
			KEYCHAIN_ACCOUNT,
			rawValue,
		);
	} catch (_error) {
		return false;
	}
}

function loadToken() {
	if (runtime.tokenCache !== undefined) {
		return runtime.tokenCache;
	}

	var rawToken = readTokenFromKeychain();
	if (!rawToken) {
		rawToken =
			runtime.file && runtime.file.exists(TOKEN_FALLBACK_PATH)
				? runtime.file.read(TOKEN_FALLBACK_PATH) || ""
				: "";
	}

	if (!rawToken) {
		runtime.tokenCache = null;
		return runtime.tokenCache;
	}

	try {
		runtime.tokenCache = JSON.parse(rawToken);
	} catch (_error) {
		runtime.tokenCache = null;
	}

	return runtime.tokenCache;
}

function saveToken(token) {
	runtime.tokenCache = token || null;
	clearViewerProfileCache();
	clearRecentHistoryCache();
	var rawValue = JSON.stringify(runtime.tokenCache || {});
	if (!writeTokenToKeychain(rawValue)) {
		log(
			"Warning: keychain write failed, falling back to @data token storage",
		);
	}
	if (runtime.file) {
		runtime.file.write(TOKEN_FALLBACK_PATH, rawValue);
	}
}

function clearToken() {
	runtime.tokenCache = null;
	runtime.lastAuthFailureAt = 0;
	runtime.lastAuthFailureMessage = "";
	runtime.authCode = "";
	runtime.authUrl = "";
	clearViewerProfileCache();
	clearRecentHistoryCache();
	writeTokenToKeychain("");
	if (runtime.file) {
		runtime.file.write(TOKEN_FALLBACK_PATH, "");
	}
}

function isTokenExpired(token) {
	if (!token || !token.created_at || !token.expires_in) {
		return true;
	}

	var expiresAt =
		Number(token.created_at || 0) +
		Number(token.expires_in || 0) -
		TOKEN_REFRESH_MARGIN_SECONDS;
	return expiresAt <= nowSeconds();
}

function parseJson(text) {
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch (_error) {
		return {};
	}
}

function escapeAppleScriptString(value) {
	return String(value || "")
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"');
}

async function copyToClipboard(text) {
	if (!runtime.utils || typeof runtime.utils.exec !== "function") {
		return false;
	}

	try {
		await runtime.utils.exec("/usr/bin/osascript", [
			"-e",
			'set the clipboard to "' + escapeAppleScriptString(text) + '"',
		]);
		return true;
	} catch (_error) {
		return false;
	}
}

async function showManualAuthDialog(userCode, verificationUrl) {
	if (!runtime.utils || typeof runtime.utils.exec !== "function") {
		return false;
	}

	var script =
		'display dialog "Enter this code to authenticate with Trakt:"' +
		' & linefeed & linefeed & "' +
		escapeAppleScriptString(userCode) +
		'"' +
		' buttons {"OK"} default button "OK" with title "Trakt Scrobbler"';

	try {
		await runtime.utils.exec("/usr/bin/osascript", ["-e", script]);
		return true;
	} catch (_error) {
		return false;
	}
}

async function copyPendingAuthCode() {
	if (!runtime.authCode) {
		return {
			ok: false,
			message: "No active code.",
		};
	}

	var copied = await copyToClipboard(runtime.authCode);
	return copied
		? { ok: true, message: "Code copied." }
		: { ok: false, message: "Copy failed. Copy manually." };
}

function encodeQuery(params) {
	var keys = Object.keys(params || {}).filter(function (key) {
		var value = params[key];
		return value !== undefined && value !== null && value !== "";
	});

	if (!keys.length) {
		return "";
	}

	return keys
		.map(function (key) {
			return (
				encodeURIComponent(key) +
				"=" +
				encodeURIComponent(String(params[key]))
			);
		})
		.join("&");
}

function summarizeBody(value) {
	try {
		return JSON.stringify(value);
	} catch (_error) {
		return String(value);
	}
}

function normalizeScrobbleVerb(verb, progress) {
	var resolvedVerb = String(verb || "");
	var resolvedProgress = Number(progress || 0);

	if (resolvedVerb === "pause" && resolvedProgress >= 80) {
		return "stop";
	}

	return resolvedVerb;
}

function shouldSkipEarlyScrobble(verb, progress) {
	return (
		(verb === "pause" || verb === "stop") && Number(progress || 0) < 1
	);
}

function earlyScrobbleReason(verb) {
	if (verb === "stop") return "stop-too-early";
	return "pause-too-early";
}

function getApiStatus() {
	return runtime.apiGate ? runtime.apiGate.status()
		: { mode: "online", retryInSeconds: 0, queuedWrites: 0 };
}

function splitCurlHeaders(raw) {
	var rest = String(raw || ""), headers = {};
	for (var i = 0; i < 6; i++) {
		var block = rest.match(/^HTTP\/[^\r\n]+\r?\n([\s\S]*?)\r?\n\r?\n/);
		if (!block) break;
		block[1].split(/\r?\n/).forEach(function(line) {
			var colon = line.indexOf(":");
			if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
		});
		rest = rest.slice(block[0].length);
	}
	return { body: rest, headers: headers };
}

async function rawRequest(method, path, options) {
	if (!runtime.utils || typeof runtime.utils.exec !== "function") {
		throw new Error("utils.exec is unavailable");
	}

	var settings = options || {};
	var query = encodeQuery(settings.query || {});
	var url = API_ROOT + path + (query ? "?" + query : "");
	var marker = "__IINA_TRAKT_STATUS__:";
	var args = [
		"-sS",
		"-D",
		"-",
		"-L",
		"--connect-timeout",
		"5",
		"--max-time",
		"12",
		"-X",
		String(method || "GET").toUpperCase(),
		"-H",
		"Accept: application/json",
	];

	Object.keys(settings.headers || {}).forEach(function (name) {
		args.push("-H", name + ": " + settings.headers[name]);
	});

	if (settings.body !== undefined) {
		args.push("--data", JSON.stringify(settings.body));
	}

	args.push("-w", "\n" + marker + "%{http_code}");
	args.push(url);

	// Central gate controls cooldown and serializes all POST/PUT/DELETE requests.
	// Never retry a POST blindly: it may already have reached Trakt.
	var send = async function() {
		log("HTTP " + String(method || "GET").toUpperCase() + " " + url);
		var response = await runtime.utils.exec("/usr/bin/curl", args);
		var stdout = response.stdout || "";
		var stderr = response.stderr || "";
		var markerIndex = stdout.lastIndexOf(marker);
		var rawPayload = markerIndex >= 0
			? stdout.slice(0, markerIndex).trim() : stdout.trim();
		var decoded = splitCurlHeaders(rawPayload);
		var rawBody = decoded.body.trim();
		var statusCode = markerIndex >= 0
			? parseInt(stdout.slice(markerIndex + marker.length).trim(), 10) : 0;
		if (response.status !== 0) {
			throw new Error(stderr || "curl failed with status " + response.status);
		}
		return {
			statusCode: statusCode,
			body: parseJson(rawBody),
			rawBody: rawBody,
			headers: decoded.headers,
			url: url
		};
	};
	return runtime.apiGate ? runtime.apiGate.request(String(method || "GET").toUpperCase(), send) : send();
}

function getAuthStatus() {
	var mode = credentialMode();
	var token = loadToken();
	var tokenInfo = getTokenInfo();

	if (runtime.authPromise) {
		return createAuthStatus(
			"authorizing",
			"Waiting for Trakt authorization",
			runtime.authPrompt ||
				"Complete the confirmation in your browser.",
			true,
			{
				deviceCode: runtime.authCode || "",
				verificationUrl: runtime.authUrl || "",
				token: tokenInfo,
			},
		);
	}

	if (mode === "missing") {
		return createAuthStatus(
			"missing_credentials",
			"Trakt credentials unavailable",
			"This build has no bundled credentials and no local override is set.",
			false,
			{
				token: tokenInfo,
			},
		);
	}

	if (token && token.access_token) {
		return createAuthStatus(
			"connected",
			"Connected to Trakt",
			mode === "bundled"
				? "Using bundled Trakt app credentials."
				: "Using local Trakt credential override.",
			false,
			{
				token: tokenInfo,
			},
		);
	}

	if (runtime.lastAuthFailureMessage) {
		return createAuthStatus(
			"error",
			"Trakt authorization failed",
			runtime.lastAuthFailureMessage,
			false,
			{
				token: tokenInfo,
			},
		);
	}

	return createAuthStatus(
		"disconnected",
		"Not connected to Trakt",
		"Use Connect to start device authorization.",
		false,
		{
			token: tokenInfo,
		},
	);
}

function normalizeViewerProfile(body) {
	var payload = body || {};
	var user = payload.user || payload.account || payload;
	var ids = user && user.ids ? user.ids : {};
	var username = String(
		(user && (user.username || user.slug)) ||
			ids.slug ||
			payload.username ||
			"",
	).trim();

	if (!username) {
		return null;
	}

	var joinedAt =
		(payload.account && payload.account.joined_at) ||
		user.joined_at ||
		"";

	return {
		username: username,
		name: String((user && user.name) || payload.name || "").trim(),
		vip: !!(
			(user && user.vip) ||
			(payload.account && payload.account.vip)
		),
		joinedAt: joinedAt || "",
	};
}

function pad2(value) {
	return String(Number(value || 0)).padStart(2, "0");
}

function normalizeHistoryItem(entry) {
	if (!entry || typeof entry !== "object") {
		return null;
	}

	var type = String(entry.type || "").trim();
	var watchedAt = String(entry.watched_at || "").trim();
	var historyId = Number(entry.id || 0);
	var label = "";

	if (type === "movie" && entry.movie) {
		label = String(entry.movie.title || "").trim();
		if (entry.movie.year) {
			label += " (" + entry.movie.year + ")";
		}
	} else if (type === "episode") {
		var showTitle =
			entry.show && entry.show.title
				? String(entry.show.title).trim()
				: "";
		var episode = entry.episode || {};
		var episodeCode =
			"S" + pad2(episode.season) + "E" + pad2(episode.number);
		var episodeTitle = String(episode.title || "").trim();
		label = (showTitle ? showTitle + " " : "") + episodeCode;
		if (episodeTitle) {
			label += " - " + episodeTitle;
		}
	} else if (type === "show" && entry.show) {
		label = String(entry.show.title || "").trim();
	}

	if (!label) {
		return null;
	}

	return {
		id: historyId || 0,
		type: type || "unknown",
		label: label,
		watchedAt: watchedAt,
	};
}

async function getRecentHistory(options) {
	var settings = options || {};
	var authStatus = getAuthStatus();
	if (!authStatus.connected) {
		return {
			items: [],
			fetchedAt: "",
		};
	}

	if (
		!settings.force &&
		runtime.recentHistory &&
		runtime.recentHistoryFetchedAt &&
		Date.now() - runtime.recentHistoryFetchedAt < HISTORY_CACHE_TTL_MS &&
		(!runtime.recentHistory.error ||
			(runtime.apiGate && runtime.apiGate.status().mode !== "online"))
	) {
		return runtime.recentHistory;
	}

	var response;
	try {
		response = await authedRequest("GET", "/users/me/history", {
			query: {
				start_at: new Date(
					Date.now() - HISTORY_LOOKBACK_MS,
				).toISOString(),
				page: 1,
				limit: settings.limit || HISTORY_LIMIT,
			},
		});
	} catch (error) {
		if (isAuthRequiredError(error)) {
			return {
				items: [],
				fetchedAt: "",
				error: "",
			};
		}
		var existing = runtime.recentHistory || { items: [], fetchedAt: "" };
		runtime.recentHistory = {
			items: existing.items || [],
			fetchedAt: existing.fetchedAt || "",
			error: String(error && error.message ? error.message : error),
		};
		runtime.recentHistoryFetchedAt = Date.now();
		log(
			"Recent Trakt history unavailable: " +
				runtime.recentHistory.error,
		);
		return runtime.recentHistory;
	}

	if (response.statusCode >= 400) {
		runtime.recentHistory = {
			items: [],
			fetchedAt: "",
			error:
				response.body.error_description ||
				response.body.error ||
				"Failed to load Trakt history",
		};
		runtime.recentHistoryFetchedAt = Date.now();
		log(
			"Recent Trakt history unavailable: " +
				runtime.recentHistory.error,
		);
		return runtime.recentHistory;
	}

	var items = Array.isArray(response.body)
		? response.body.map(normalizeHistoryItem).filter(Boolean)
		: [];

	runtime.recentHistory = {
		items: items,
		fetchedAt: new Date().toISOString(),
		error: "",
	};
	runtime.recentHistoryFetchedAt = Date.now();
	return runtime.recentHistory;
}

async function getViewerProfile(options) {
	var settings = options || {};
	var authStatus = getAuthStatus();
	if (!authStatus.connected) {
		return null;
	}

	if (
		!settings.force &&
		runtime.viewerProfileFetchedAt &&
		Date.now() - runtime.viewerProfileFetchedAt < PROFILE_CACHE_TTL_MS
	) {
		return runtime.viewerProfile;
	}

	var response;
	try {
		response = await authedRequest("GET", USER_SETTINGS_PATH);
	} catch (error) {
		runtime.viewerProfileFetchedAt = runtime.viewerProfile ? Date.now() : 0;
		if ((error.code === "TRAKT_COOLDOWN" || error.code === "TRAKT_OFFLINE") &&
			runtime.viewerProfile) return runtime.viewerProfile;
		throw error;
	}

	if (response.statusCode >= 400) {
		runtime.viewerProfileFetchedAt = runtime.viewerProfile ? Date.now() : 0;
		throw new Error(
			response.body.error_description ||
				response.body.error ||
				"Failed to load Trakt account details",
		);
	}

	runtime.viewerProfile = normalizeViewerProfile(response.body);
	runtime.viewerProfileFetchedAt = Date.now();
	return runtime.viewerProfile;
}

function requiredHeaders(accessToken) {
	var headers = {
		"Content-Type": "application/json",
		"trakt-api-key": getClientId(),
		"trakt-api-version": "2",
	};

	if (accessToken) {
		headers.Authorization = "Bearer " + accessToken;
	}

	return headers;
}

async function refreshAccessToken(token) {
	var refreshToken = token && token.refresh_token;
	if (!refreshToken) {
		throw new Error("Refresh token is missing");
	}

	var response = await rawRequest("POST", TOKEN_PATH, {
		headers: {
			"Content-Type": "application/json",
		},
		body: {
			refresh_token: refreshToken,
			client_id: getClientId(),
			client_secret: getClientSecret(),
			redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
			grant_type: "refresh_token",
		},
	});

	if (response.statusCode !== 200) {
		var err = new Error(
			response.body.error_description ||
				response.body.error ||
				"Trakt token refresh failed"
		);
		err.statusCode = response.statusCode;
		// Keep credentials through temporary Trakt outages; only reject invalid refresh.
		if (response.statusCode === 400 || response.statusCode === 401) {
			clearToken();
		}
		throw err;
	}

	saveToken(response.body);
	log("Refreshed Trakt access token");
	return response.body.access_token;
}

async function runDeviceAuth(options) {
	var settings = options || {};
	var now = Date.now();
	if (
		runtime.lastAuthFailureAt &&
		now - runtime.lastAuthFailureAt < AUTH_COOLDOWN_MS
	) {
		throw new Error(
			runtime.lastAuthFailureMessage || "Recent Trakt auth failure",
		);
	}

	if (runtime.authPromise) {
		return runtime.authPromise;
	}

	runtime.authPromise = (async function () {
		if (!hasCredentials()) {
			throw new Error("Missing Trakt client credentials");
		}

		var codeResponse = await rawRequest("POST", DEVICE_CODE_PATH, {
			headers: {
				"Content-Type": "application/json",
			},
			body: {
				client_id: getClientId(),
			},
		});

		if (codeResponse.statusCode !== 200) {
			throw new Error(
				codeResponse.body.error_description ||
					codeResponse.body.error ||
					"Failed to request Trakt device code",
			);
		}

		var codeData = codeResponse.body || {};
		var verificationUrl = String(codeData.verification_url || "");
		var userCode = String(codeData.user_code || "");
		var deviceCode = String(codeData.device_code || "");
		var intervalMs = Math.max(
			1000,
			Number(codeData.interval || 5) * 1000,
		);
		var expiresAt =
			Date.now() +
			Math.max(1, Number(codeData.expires_in || 900)) * 1000;
		runtime.authPrompt =
			"Open " + verificationUrl + " and enter code " + userCode + ".";
		runtime.authCode = userCode;
		runtime.authUrl = verificationUrl;

		log(
			"Trakt device auth started: open " +
				verificationUrl +
				" and enter code " +
				userCode,
		);
		await copyToClipboard(userCode);
		notify("Trakt auth code " + userCode + " copied to clipboard");
		if (runtime.utils && typeof runtime.utils.open === "function") {
			try {
				runtime.utils.open(verificationUrl);
			} catch (_error) {}
		}
		if (settings.showDialog) {
			await showManualAuthDialog(userCode, verificationUrl);
		}

		while (Date.now() < expiresAt) {
			await sleep(intervalMs);
			var tokenResponse = await rawRequest(
				"POST",
				DEVICE_TOKEN_PATH,
				{
					headers: {
						"Content-Type": "application/json",
					},
					body: {
						code: deviceCode,
						client_id: getClientId(),
						client_secret: getClientSecret(),
					},
				},
			);

			if (tokenResponse.statusCode === 200) {
				saveToken(tokenResponse.body);
				runtime.authPrompt = "";
				runtime.authCode = "";
				runtime.authUrl = "";
				runtime.lastAuthFailureAt = 0;
				runtime.lastAuthFailureMessage = "";
				notify("Trakt auth complete");
				log("Trakt device auth completed");
				return tokenResponse.body.access_token;
			}

			if (tokenResponse.statusCode === 400) {
				continue;
			}

			throw new Error(
				tokenResponse.body.error_description ||
					tokenResponse.body.error ||
					"Trakt device token exchange failed",
			);
		}

		throw new Error("Timed out waiting for Trakt authorization");
	})();

	try {
		return await runtime.authPromise;
	} catch (error) {
		runtime.authPrompt = "";
		runtime.authCode = "";
		runtime.authUrl = "";
		runtime.lastAuthFailureAt = Date.now();
		runtime.lastAuthFailureMessage =
			error && error.message ? error.message : String(error);
		notify(runtime.lastAuthFailureMessage);
		throw error;
	} finally {
		runtime.authPrompt = "";
		runtime.authCode = "";
		runtime.authUrl = "";
		runtime.authPromise = null;
	}
}

async function ensureAccessToken(options) {
	var settings = options || {};
	if (!hasCredentials()) {
		throw new Error("Missing Trakt client credentials");
	}

	if (!runtime.loggedCredentialMode) {
		if (usingEmbeddedCredentials()) {
			log("Using bundled Trakt app credentials");
		} else {
			log("Using local Trakt credential overrides");
		}
		runtime.loggedCredentialMode = true;
	}

	var token = loadToken();
	if (token && !isTokenExpired(token)) {
		return token.access_token;
	}

	if (token && token.refresh_token) {
		// Multiple sidebar/history/scrobble calls can coincide at token expiry.
		// Only refresh once; rotating a refresh token twice causes forced re-auth.
		if (!runtime.tokenRefreshPromise) {
			runtime.tokenRefreshPromise = (async function() {
				try {
					return await refreshAccessToken(token);
				} catch (error) {
					log("Token refresh failed: " + (error && error.message ? error.message : String(error)));
					// Rate limits, network errors and 5xx are recoverable. Keep OAuth.
					if (!error || !error.statusCode || error.statusCode >= 500 ||
						error.code === "TRAKT_COOLDOWN" || error.code === "TRAKT_OFFLINE") throw error;
					if (error.statusCode !== 400 && error.statusCode !== 401) throw error;
					clearToken();
					throw createAuthRequiredError();
				}
			})();
			var inFlight = runtime.tokenRefreshPromise;
			inFlight.then(function() {
				if (runtime.tokenRefreshPromise === inFlight) runtime.tokenRefreshPromise = null;
			}, function() {
				if (runtime.tokenRefreshPromise === inFlight) runtime.tokenRefreshPromise = null;
			});
		}
		return runtime.tokenRefreshPromise;
	}

	if (settings.interactive) {
		return runDeviceAuth(settings);
	}

	throw createAuthRequiredError();
}

async function beginInteractiveAuth(options) {
	var settings = options || {};
	if (settings.force) {
		clearToken();
	}

	await ensureAccessToken({
		interactive: true,
		showDialog: !!settings.showDialog,
	});
	return getAuthStatus();
}

async function authedRequest(method, path, options) {
	var settings = options || {};
	var token = await ensureAccessToken({
		interactive: !!settings.interactive,
		showDialog: !!settings.showDialog,
	});
	var response = await rawRequest(method, path, {
		headers: Object.assign(
			{},
			requiredHeaders(token),
			settings.headers || {},
		),
		query: settings.query,
		body: settings.body,
	});

	if (response.statusCode === 401) {
		clearToken();
		token = await ensureAccessToken({
			interactive: !!settings.interactive,
			showDialog: !!settings.showDialog,
		});
		response = await rawRequest(method, path, {
			headers: Object.assign(
				{},
				requiredHeaders(token),
				settings.headers || {},
			),
			query: settings.query,
			body: settings.body,
		});
	}

	return response;
}

function loadSearchCache() {
	if (runtime.searchCache) {
		return runtime.searchCache;
	}

	var cache = readJson(CACHE_PATH, null);
	if (!cache || typeof cache !== "object") {
		cache = {
			movie: {},
			show: {},
		};
	}
	if (!cache.movie) cache.movie = {};
	if (!cache.show) cache.show = {};
	runtime.searchCache = cache;
	return runtime.searchCache;
}

function saveSearchCache() {
	if (!runtime.searchCache) return;
	writeJson(CACHE_PATH, runtime.searchCache);
}

function searchCacheKey(title, year) {
	return (
		String(title || "")
			.trim()
			.toLowerCase() +
		"|" +
		String(year || "").trim()
	);
}

function mediaCacheKey(mediaInfo) {
  var title = mediaInfo.type === "episode"
    ? (mediaInfo.showTitle || mediaInfo.title)
    : mediaInfo.title;
  var titleKey = searchCacheKey(title, mediaInfo.year || "");
  var imdb = String(mediaInfo.imdb || "").trim().toLowerCase();
  // Never share a cache entry with a different IMDb identity.
  return /^tt\d{6,10}$/.test(imdb) ? "imdb:" + imdb + "|" + titleKey : titleKey;
}

function normalizeTitle(value) {
	var text = String(value || "").toLowerCase();
	if (typeof text.normalize === "function") {
		text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
	}
	return text.replace(/&/g, " and ")
		.replace(/['’]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// Trakt's relevance score is not sufficient proof of media identity.
// For title-only matching, refuse translations or partial phrase overlap
// unless a trusted external ID is present. Localized names can use Manual Match.
function titleIdentityMatches(requested, candidate) {
	var left = normalizeTitle(requested);
	var right = normalizeTitle(candidate);
	return !!left && !!right && left === right;
}

function readCachedTraktId(value) {
	if (value && typeof value === "object") {
		return Number(value.trakt || 0);
	}

	return Number(value || 0);
}

function isVerifiedEpisodeCacheEntry(value) {
	return !!(
		value &&
		typeof value === "object" &&
		value.verified === true &&
		Number(value.trakt || 0) > 0
	);
}

function createVerifiedEpisodeCacheEntry(traktId) {
	return {
		trakt: Number(traktId || 0),
		verified: true,
	};
}

function episodeIdentityLabel(mediaInfo) {
	return (
		String(mediaInfo.showTitle || mediaInfo.title || "Unknown Show") +
		" S" +
		String(mediaInfo.season || "?") +
		"E" +
		String(mediaInfo.episode || "?")
	);
}

function mediaIdentityLabel(mediaInfo) {
	if (!mediaInfo) return "unknown media";
	if (mediaInfo.type === "episode") {
		var suffix = mediaInfo.episodeTitle
			? " - " + mediaInfo.episodeTitle
			: "";
		return (
			String(
				mediaInfo.showTitle || mediaInfo.title || "Unknown Show",
			) +
			" S" +
			String(Number(mediaInfo.season || 0)).padStart(2, "0") +
			"E" +
			String(Number(mediaInfo.episode || 0)).padStart(2, "0") +
			suffix
		);
	}
	return (
		String(mediaInfo.title || "Unknown Movie") +
		(mediaInfo.year ? " (" + mediaInfo.year + ")" : "")
	);
}

function titlesMatch(expected, actual) {
	var left = normalizeTitle(expected);
	var right = normalizeTitle(actual);
	if (!left || !right) return false;
	return left === right;
}

async function search(query, type, year, limit, field) {
	var response = await authedRequest("GET", "/search/" + type, {
		query: {
			query: query,
			field: field || undefined,
			years: year || undefined,
			page: 1,
			limit: limit || 1,
		},
	});

	if (response.statusCode >= 400) {
		throw new Error(
			response.body.error_description ||
				response.body.error ||
				"Trakt search failed with status " + response.statusCode,
		);
	}

	return Array.isArray(response.body) ? response.body : [];
}

function traktReferenceSegment(reference) {
	var value = String(reference || "").trim();
	if (!value) {
		throw new Error("A valid Trakt ID or slug is required.");
	}
	return encodeURIComponent(value);
}

async function fetchMovieByReference(reference) {
	var response = await authedRequest(
		"GET",
		"/movies/" + traktReferenceSegment(reference),
		{
			query: {
				extended: "full",
			},
		},
	);

	if (response.statusCode === 404) {
		return null;
	}

	if (response.statusCode >= 400) {
		throw new Error(
			response.body.error_description ||
				response.body.error ||
				"Trakt movie lookup failed with status " +
					response.statusCode,
		);
	}

	return response.body || null;
}

async function fetchShowByReference(reference) {
	var response = await authedRequest(
		"GET",
		"/shows/" + traktReferenceSegment(reference),
		{
			query: {
				extended: "full",
			},
		},
	);

	if (response.statusCode === 404) {
		return null;
	}

	if (response.statusCode >= 400) {
		throw new Error(
			response.body.error_description ||
				response.body.error ||
				"Trakt show lookup failed with status " +
					response.statusCode,
		);
	}

	return response.body || null;
}

async function fetchEpisodeForShow(showReference, season, episode) {
	var response = await authedRequest(
		"GET",
		"/shows/" +
			traktReferenceSegment(showReference) +
			"/seasons/" +
			Number(season) +
			"/episodes/" +
			Number(episode),
	);

	if (response.statusCode === 404) {
		return null;
	}

	if (response.statusCode >= 400) {
		throw new Error(
			response.body.error_description ||
				response.body.error ||
				"Trakt episode lookup failed with status " +
					response.statusCode,
		);
	}

	return response.body || null;
}

async function verifyEpisodeCandidate(traktId, mediaInfo) {
	var episode = await fetchEpisodeForShow(
		traktId,
		mediaInfo.season,
		mediaInfo.episode,
	);
	if (!episode) {
		log(
			"Trakt episode candidate rejected: show=" +
				traktId +
				" missing " +
				episodeIdentityLabel(mediaInfo),
		);
		return null;
	}

	var titleMatched = titlesMatch(
		mediaInfo.episodeTitle,
		episode.title,
	);
	log(
		"Trakt episode candidate verified: show=" +
			traktId +
			" " +
			episodeIdentityLabel(mediaInfo) +
			(episode.title ? ' title="' + episode.title + '"' : "") +
			(mediaInfo.episodeTitle
				? " parsedTitleMatch=" + (titleMatched ? "yes" : "no")
				: ""),
	);

	return {
		trakt: Number(traktId || 0),
		titleMatched: titleMatched,
		episode: episode,
	};
}

function summarizeSearchCandidate(result) {
	var show = result && result.show;
	if (!show || !show.ids) {
		return "invalid";
	}

	return (
		"#" +
		String(show.ids.trakt || "?") +
		" " +
		String(show.title || "Unknown") +
		(show.year ? " (" + show.year + ")" : "") +
		" score=" +
		String(Number(result.score || 0))
	);
}

function normalizeImageUrl(value) {
	var url = String(value || "").trim();
	if (!url) return "";
	if (/^https?:\/\//i.test(url)) return url;
	if (/^\/\//.test(url)) return "https:" + url;
	return "https://" + url.replace(/^\/+/, "");
}

function posterUrlFromImages(images) {
	var poster = images && images.poster;
	if (!poster) return "";

	if (typeof poster === "string") {
		return normalizeImageUrl(poster);
	}

	if (Array.isArray(poster)) {
		for (var index = 0; index < poster.length; index += 1) {
			var arrayValue = normalizeImageUrl(poster[index]);
			if (arrayValue) {
				return arrayValue;
			}
		}
		return "";
	}

	var candidates = [
		poster.full,
		poster.medium,
		poster.thumb,
		poster.small,
	];

	for (var index = 0; index < candidates.length; index += 1) {
		var value = normalizeImageUrl(candidates[index]);
		if (value) {
			return value;
		}

		var rawValue = candidates[index];
		if (
			rawValue &&
			typeof rawValue === "object" &&
			typeof rawValue.url === "string"
		) {
			value = normalizeImageUrl(rawValue.url);
			if (value) {
				return value;
			}
		}
	}

	return "";
}

function correctionEpisodeDetail(mediaInfo, episode, titleMatched) {
	var label =
		"S" + pad2(mediaInfo.season) + "E" + pad2(mediaInfo.episode);

	if (episode && episode.title) {
		label += " - " + String(episode.title).trim();
	}

	if (titleMatched) {
		label += " · title match";
	}

	return label;
}

function normalizeMovieCorrectionRecord(movie) {
	if (!movie || !movie.ids || !movie.ids.trakt) {
		return null;
	}

	return {
		trakt: Number(movie.ids.trakt || 0),
		kind: "movie",
		title: String(movie.title || "").trim(),
		subtitle: movie.year ? "Movie · " + movie.year : "Movie",
		detail: "",
		year: movie.year ? Number(movie.year) : null,
		posterUrl: posterUrlFromImages(movie.images),
	};
}

function normalizeMovieCorrectionCandidate(result) {
	var movie = result && result.movie;
	var normalized = normalizeMovieCorrectionRecord(movie);
	if (!normalized) return null;
	normalized.score = Number(result && result.score || 0);
	return normalized;
}

function dedupeCorrectionCandidates(candidates) {
	var list = Array.isArray(candidates) ? candidates : [];
	var seen = Object.create(null);
	var output = [];

	for (var index = 0; index < list.length; index += 1) {
		var candidate = list[index];
		var traktId = candidate ? Number(candidate.trakt || 0) : 0;
		if (!traktId || seen[traktId]) {
			continue;
		}
		seen[traktId] = true;
		output.push(candidate);
	}

	return output;
}

function movieCorrectionSortValue(candidate, mediaInfo, query) {
	var score = Number(candidate && candidate.score || 0);
	var title = candidate && candidate.title ? candidate.title : "";
	var normalizedQuery = normalizeTitle(query || "");
	var normalizedTitle = normalizeTitle(title);
	var parsedTitle = normalizeTitle(mediaInfo && mediaInfo.title || "");
	var year = mediaInfo && mediaInfo.year ? Number(mediaInfo.year) : 0;
	var candidateYear = candidate && candidate.year ? Number(candidate.year) : 0;
	var exactQueryMatch = normalizedQuery && normalizedTitle === normalizedQuery ? 1 : 0;
	var exactParsedTitleMatch = parsedTitle && normalizedTitle === parsedTitle ? 1 : 0;
	var yearMatch = year && candidateYear === year ? 1 : 0;

	return (
		(exactQueryMatch * 1000000) +
		(exactParsedTitleMatch * 500000) +
		(yearMatch * 100000) +
		Math.round(score)
	);
}

function summarizeMovieCorrectionCandidate(candidate) {
	if (!candidate) {
		return "invalid";
	}

	return (
		"#" +
		String(candidate.trakt || "?") +
		" " +
		String(candidate.title || "Unknown") +
		(candidate.year ? " (" + candidate.year + ")" : "") +
		" score=" +
		String(Number(candidate.score || 0))
	);
}

function normalizeEpisodeCorrectionCandidate(
	result,
	mediaInfo,
	verified,
) {
	var show = result && result.show;
	if (!verified) {
		return null;
	}

	return normalizeEpisodeCorrectionRecord(show, mediaInfo, verified);
}

function normalizeEpisodeCorrectionRecord(show, mediaInfo, verified) {
	if (!show || !show.ids || !show.ids.trakt) {
		return null;
	}

	return {
		trakt: Number(show.ids.trakt || 0),
		kind: "episode",
		title: String(show.title || "").trim(),
		subtitle: show.year ? "Show · " + show.year : "Show",
		detail: verified
			? correctionEpisodeDetail(mediaInfo, verified.episode, verified.titleMatched)
			: "Choose Season and Episode below before applying",
		year: show.year ? Number(show.year) : null,
		posterUrl: posterUrlFromImages(show.images),
	};
}

// AIOStreams' #aios_title is structured playback context, NOT a trusted
// external ID. Reject fuzzy matches and NEVER fall back to the first TV show
// merely because it also has SxxExx (the former "Magical Index" false positive).
async function resolveAiosEpisodeIds(mediaInfo, bucket, key) {
  var title = String(mediaInfo.showTitle || mediaInfo.title || "").trim();
  var season = Number(mediaInfo.season), episode = Number(mediaInfo.episode);
  if (!title || !Number.isInteger(season) || season < 0 || season > 100 ||
      !Number.isInteger(episode) || episode < 1 || episode > 9999) return null;
  var normalizedTitle = normalizeTitle(title);
  var episodeKey = normalizeTitle(mediaInfo.episodeTitle);
  var year = Number(mediaInfo.year || 0);
  var cached = bucket[key];
  if (cached && cached.aiosExact === true && cached.verified === true &&
      cached.titleKey === normalizedTitle && Number(cached.trakt) > 0 &&
      (!cached.aliasVerified ||
       (cached.episodeKey === episodeKey && Number(cached.year || 0) === year)))
    return {trakt:Number(cached.trakt)};

  var results = await search(title, "show", year || undefined, 20);
  if ((!results || !results.length) && year)
    results = await search(title, "show", undefined, 20);
  var exactById = Object.create(null);
  (results || []).forEach(function(record) {
    var show = record && record.show;
    var id = Number(show && show.ids && show.ids.trakt || 0);
    if (!id || Number(record.score || 0) < SEARCH_SCORE_THRESHOLD ||
        !titleIdentityMatches(title, show.title)) return;
    if (year && Number(show.year) !== year) return;
    exactById[id] = id;
  });
  var ids = Object.keys(exactById).map(Number);
  if (ids.length === 1) {
    var exact = await verifyEpisodeCandidate(ids[0], mediaInfo);
    if (!exact) return null;
    bucket[key] = {trakt:ids[0],verified:true,aiosExact:true,titleKey:normalizedTitle};
    saveSearchCache();
    return {trakt:ids[0]};
  }
  if (ids.length > 1) {
    log("AIOStreams exact title ambiguous; Manual Match required for " +
      episodeIdentityLabel(mediaInfo));
    return null;
  }

  // TheTVDB/AIOStreams may name the Netflix show "The Diplomat (US)"
  // while Trakt calls it "The Diplomat". Only allow a bounded country-tag
  // alias, NEVER arbitrary fuzzy or prefix title matching.
  var suffix = /^(.*?)\s+\((US|UK|AU|CA|NZ)\)$/i.exec(title);
  var bareTitle = suffix && String(suffix[1] || "").trim();
  if (!bareTitle || !episodeKey || bareTitle.length < 3) {
    log("AIOStreams title lookup rejected: no exact Trakt show for " +
      episodeIdentityLabel(mediaInfo));
    return null;
  }
  var aliasResults = await search(bareTitle, "show", year || undefined, 20);
  if ((!aliasResults || !aliasResults.length) && year)
    aliasResults = await search(bareTitle, "show", undefined, 20);
  // If results are truncated, uniqueness cannot be established safely.
  if (!aliasResults || aliasResults.length >= 20) {
    log("AIOStreams alias lookup truncated/unavailable; Manual Match required.");
    return null;
  }
  var candidates = Object.create(null);
  aliasResults.forEach(function(record) {
    var show = record && record.show;
    var id = Number(show && show.ids && show.ids.trakt || 0);
    if (!id || Number(record.score || 0) < SEARCH_SCORE_THRESHOLD ||
        !titleIdentityMatches(bareTitle, show.title)) return;
    // A matching local release year is additional evidence, never a reason
    // to accept a conflicting Trakt production year.
    if (year && Number(show.year) !== year) return;
    candidates[id] = id;
  });
  var aliasIds = Object.keys(candidates).map(Number);
  if (!aliasIds.length || aliasIds.length > 8) return null;
  var verifiedIds = [];
  for (var index = 0; index < aliasIds.length; index++) {
    var checked = await verifyEpisodeCandidate(aliasIds[index], mediaInfo);
    // For a country alias, episode existence alone is NOT enough. Require
    // the full episode TITLE to match too, and exactly one candidate.
    if (checked && checked.episode &&
        titleIdentityMatches(mediaInfo.episodeTitle, checked.episode.title))
      verifiedIds.push(aliasIds[index]);
  }
  if (verifiedIds.length !== 1) {
    log("AIOStreams country-tag alias rejected: exact episode title matches=" +
      verifiedIds.length + " for " + episodeIdentityLabel(mediaInfo));
    return null;
  }
  bucket[key] = {trakt:verifiedIds[0],verified:true,aiosExact:true,
    aliasVerified:true,titleKey:normalizedTitle,episodeKey:episodeKey,year:year};
  saveSearchCache();
  log("AIOStreams country-tag alias verified with exact Trakt episode title.");
  return {trakt:verifiedIds[0]};
}
// Movie titles from #aios_title are context, not an external media ID.
// Require a corroborated production year and a unique exact Trakt movie match;
// never auto-scrobble the first relevance-ranked movie from a title alone.
async function resolveAiosMovieIds(mediaInfo, bucket, key) {
  var title = String(mediaInfo.title || "").trim();
  var year = Number(mediaInfo.year || 0);
  if (!title || !Number.isInteger(year) || year < 1900 || year > 2100) {
    log("AIOStreams movie needs a corroborated year or Manual Match.");
    return null;
  }
  var titleKey = normalizeTitle(title);
  var saved = bucket[key];
  if (saved && saved.aiosMovieExact === true && saved.verified === true &&
      saved.titleKey === titleKey && Number(saved.year) === year &&
      Number(saved.trakt) > 0) return {trakt:Number(saved.trakt)};
  var results = await search(title, "movie", year, 20);
  if (!Array.isArray(results) || results.length >= 20) {
    log("AIOStreams movie search failed or returned a truncated page.");
    return null;
  }
  // Trakt search scores may prefer the wrong franchise/remake.
  var exact = Object.create(null);
  results.forEach(function(row) {
    var movie = row && row.movie;
    var id = Number(movie && movie.ids && movie.ids.trakt || 0);
    if (!id || Number(row.score || 0) < SEARCH_SCORE_THRESHOLD ||
        !titleIdentityMatches(title, movie.title) ||
        Number(movie.year) !== year) return;
    exact[id] = id;
  });
  var ids = Object.keys(exact).map(Number);
  if (ids.length !== 1) {
    log("AIOStreams movie title/year ambiguous or unmatched; candidates=" + ids.length);
    return null;
  }
  var confirmed = await fetchMovieByReference(ids[0]);
  if (!confirmed || !confirmed.ids ||
      Number(confirmed.ids.trakt) !== ids[0] ||
      !titleIdentityMatches(title, confirmed.title) ||
      Number(confirmed.year) !== year) {
    log("AIOStreams movie lookup failed canonical title/year confirmation.");
    return null;
  }
  bucket[key] = {trakt:ids[0],verified:true,aiosMovieExact:true,
    titleKey:titleKey,year:year};
  saveSearchCache();
  return {trakt:ids[0]};
}

async function resolveEpisodeIds(mediaInfo, bucket, key) {
	if (mediaInfo.unresolvedShow) {
		log("MediaFusion episode route has season/episode but no trusted show identity; manual correction required.");
		return null;
	}
	var explicit = Number(mediaInfo.manualTraktId || 0);
	if (Number.isInteger(explicit) && explicit > 0) {
		if (isVerifiedEpisodeCacheEntry(bucket[key]) &&
			readCachedTraktId(bucket[key]) === explicit) return {trakt:explicit};
		var checked = await verifyEpisodeCandidate(explicit, mediaInfo);
		if (!checked) return null;
		bucket[key] = createVerifiedEpisodeCacheEntry(explicit);
		saveSearchCache();
		return {trakt:explicit};
	}
	var cached = bucket[key];
	var cachedId = readCachedTraktId(cached);

	if (cached === 0 || cached === -1 || cachedId === -1) {
		return null;
	}

	if (cachedId > 0) {
		if (isVerifiedEpisodeCacheEntry(cached)) {
			return { trakt: cachedId };
		}

		log(
			"Trakt episode cache hit requires verification: show=" +
				cachedId +
				" for " +
				episodeIdentityLabel(mediaInfo),
		);
		if (await verifyEpisodeCandidate(cachedId, mediaInfo)) {
			bucket[key] = createVerifiedEpisodeCacheEntry(cachedId);
			saveSearchCache();
			return { trakt: cachedId };
		}

		delete bucket[key];
		saveSearchCache();
		log(
			"Trakt episode cache entry invalidated for " +
				episodeIdentityLabel(mediaInfo),
		);
	}

	var imdb = String(mediaInfo.imdb || "").trim().toLowerCase();
	if (/^tt\d{6,10}$/.test(imdb)) {
		// Trakt accepts IMDb identities on its show detail endpoint.
		var identifiedShow = await fetchShowByReference(imdb);
		if (identifiedShow && identifiedShow.ids && identifiedShow.ids.trakt) {
			var direct = await verifyEpisodeCandidate(identifiedShow.ids.trakt, mediaInfo);
			if (!direct) {
				// An explicit ID + invalid episode must not fall back to a guessed show.
				log("Trakt IMDb identity has no matching episode: " + episodeIdentityLabel(mediaInfo));
				bucket[key] = -1;
				saveSearchCache();
				return null;
			}
			bucket[key] = createVerifiedEpisodeCacheEntry(direct.trakt);
			saveSearchCache();
			log("Trakt resolved show by IMDb reference " + imdb);
			return { trakt: direct.trakt };
		}
	}

	var title = mediaInfo.showTitle || mediaInfo.title;
	var year = mediaInfo.year || "";
	var results = await search(title, "show", year || undefined, 5);

	if ((!results || !results.length) && year) {
		results = await search(title, "show", undefined, 5);
	}

	if (!results || !results.length) {
		bucket[key] = -1;
		saveSearchCache();
		return null;
	}

	log(
		"Trakt show search candidates for " +
			episodeIdentityLabel(mediaInfo) +
			": " +
			results.map(summarizeSearchCandidate).join(" | "),
	);

	var verified = [];
	for (var index = 0; index < results.length; index += 1) {
		var candidate = results[index] || {};
		var show = candidate.show;
		var score = Number(candidate.score || 0);
		if (
			score < SEARCH_SCORE_THRESHOLD ||
			!show ||
			!show.ids ||
			!show.ids.trakt
		) {
			continue;
		}

		var match = await verifyEpisodeCandidate(
			show.ids.trakt,
			mediaInfo,
		);
		if (!match) {
			continue;
		}

		verified.push(match);
		if (match.titleMatched) {
			bucket[key] = createVerifiedEpisodeCacheEntry(match.trakt);
			saveSearchCache();
			return { trakt: match.trakt };
		}
	}

	if (verified.length) {
		bucket[key] = createVerifiedEpisodeCacheEntry(verified[0].trakt);
		saveSearchCache();
		return { trakt: verified[0].trakt };
	}

	bucket[key] = -1;
	saveSearchCache();
	return null;
}

async function searchCorrectionCandidates(mediaInfo, query, limit) {
	if (!mediaInfo || !mediaInfo.type) {
		return [];
	}

	var trimmedQuery = String(query || "").trim();
	if (!trimmedQuery) {
		return [];
	}

	var maxResults = 10;

	if (mediaInfo.type === "movie") {
		var movieResults = [];
		var movieQueries = [
			{
				query: trimmedQuery,
				year: undefined,
				field: undefined,
			},
			{
				query: trimmedQuery,
				year: undefined,
				field: "title",
			},
		];

		if (mediaInfo.year) {
			movieQueries.push({
				query: trimmedQuery,
				year: mediaInfo.year,
				field: undefined,
			});
			movieQueries.push({
				query: trimmedQuery + " " + String(mediaInfo.year),
				year: undefined,
				field: undefined,
			});
			movieQueries.push({
				query: trimmedQuery + " " + String(mediaInfo.year),
				year: undefined,
				field: "title",
			});
		}

		for (var queryIndex = 0; queryIndex < movieQueries.length; queryIndex += 1) {
			var movieQuery = movieQueries[queryIndex];
			var fetchedMovies = await search(
				movieQuery.query,
				"movie",
				movieQuery.year,
				maxResults,
				movieQuery.field,
			);
			movieResults = movieResults.concat(fetchedMovies || []);
		}

		var movieCandidates = [];
		var normalizedMovies = dedupeCorrectionCandidates((movieResults || [])
			.map(normalizeMovieCorrectionCandidate)
			.filter(Boolean)
		)
			.sort(function(left, right) {
				return movieCorrectionSortValue(right, mediaInfo, trimmedQuery) -
					movieCorrectionSortValue(left, mediaInfo, trimmedQuery);
			})
			.slice(0, maxResults);

		log(
			"Trakt movie correction candidates for " +
				mediaIdentityLabel(mediaInfo) +
				': query="' + trimmedQuery + '" -> ' +
				normalizedMovies.map(summarizeMovieCorrectionCandidate).join(" | ")
		);

		for (
			var movieIndex = 0;
			movieIndex < normalizedMovies.length;
			movieIndex += 1
		) {
			var movieCandidate = normalizedMovies[movieIndex];
			delete movieCandidate.score;
			movieCandidates.push(movieCandidate);
		}

		return movieCandidates;
	}

	if (mediaInfo.type !== "episode") {
		return [];
	}

	var showResults = await search(
		trimmedQuery,
		"show",
		undefined,
		maxResults,
	);

	var candidates = [];
	for (
		var index = 0;
		index < (showResults || []).length;
		index += 1
	) {
		var result = showResults[index] || {};
		var show = result.show;
		if (!show || !show.ids || !show.ids.trakt) {
			continue;
		}

		// Manual title search must not require the *guessed* episode to exist.
		// The user can correct the season/episode before applying the match.
		var normalized = normalizeEpisodeCorrectionRecord(show, mediaInfo, null);
		if (normalized) {
			candidates.push(normalized);
		}
		if (candidates.length >= maxResults) {
			break;
		}
	}

	return candidates;
}

async function lookupCorrectionReference(mediaInfo, reference) {
	if (!mediaInfo || !mediaInfo.type) {
		return null;
	}

	var resolvedReference = String(reference || "").trim();
	if (!resolvedReference) {
		return null;
	}

	if (mediaInfo.type === "movie") {
		var movie = await fetchMovieByReference(resolvedReference);
		return movie ? normalizeMovieCorrectionRecord(movie) : null;
	}

	if (mediaInfo.type === "episode") {
		var show = await fetchShowByReference(resolvedReference);
		if (!show) {
			return null;
		}

		return normalizeEpisodeCorrectionRecord(show, mediaInfo, null);
	}

	return null;
}

async function applyMatchOverride(mediaInfo, candidate) {
	if (!mediaInfo || !mediaInfo.type) {
		throw new Error("No media is available to override.");
	}

	var traktId = Number(
		candidate && typeof candidate === "object"
			? candidate.trakt
			: candidate,
	);

	if (!traktId) {
		throw new Error("A valid Trakt match is required.");
	}

	var cache = loadSearchCache();
	var title =
		mediaInfo.type === "episode"
			? mediaInfo.showTitle || mediaInfo.title
			: mediaInfo.title;
	var year = mediaInfo.year || "";
	var bucket =
		mediaInfo.type === "episode" ? cache.show : cache.movie;
	var key = mediaCacheKey(mediaInfo);

	if (mediaInfo.type === "episode") {
		var verified = await verifyEpisodeCandidate(traktId, mediaInfo);
		if (!verified) {
			throw new Error(
				"The selected show does not contain this episode.",
			);
		}

		bucket[key] = createVerifiedEpisodeCacheEntry(traktId);
	} else if (mediaInfo.type === "movie") {
		bucket[key] = { trakt: traktId, manual: true };
	} else {
		throw new Error("Unsupported media type for override.");
	}

	saveSearchCache();
	return { trakt: traktId };
}

// Fresh explicit external-ID resolution. No title-only guesses, no stream URL
// requests. The Trakt lookup must identify one media record and, for TV, the
// exact season/episode must exist before allowing any scrobble.
async function lookupTmdbByType(tmdb, kind) {
  var type=kind==="episode"?"show":"movie";
  var response=await authedRequest("GET","/search/tmdb/"+Number(tmdb),{
    query:{type:type,limit:5,page:1}
  });
  if(response.statusCode>=400)
    throw new Error("Trakt TMDB lookup failed with status "+response.statusCode);
  var matches=(Array.isArray(response.body)?response.body:[]).filter(function(x){
    var item=x&&x[type];
    return x&&x.type===type&&item&&item.ids&&
      Number(item.ids.tmdb)===Number(tmdb) && Number(item.ids.trakt)>0;
  });
  if(matches.length!==1) return null; // Zero or multiple: fail closed.
  return matches[0][type];
}
async function resolveFreshIdentity(external) {
  var identity=external||{};
  if(identity.conflict || !["episode","movie"].includes(identity.kind))return null;
  var imdb=String(identity.imdb||"").toLowerCase();
  var tmdb=Number(identity.tmdb||0);
  if(!/^tt\d{6,10}$/.test(imdb))imdb="";
  if(!Number.isInteger(tmdb)||tmdb<=0||tmdb>999999999)tmdb=0;
  if(!imdb&&!tmdb)return null;
  if(identity.kind==="episode" &&
    (!Number.isInteger(identity.season)||identity.season<0||identity.season>100||
     !Number.isInteger(identity.episode)||identity.episode<1||identity.episode>9999))
    return null;

  var byImdb=null,byTmdb=null,kind=identity.kind;
  if(imdb) byImdb=kind==="episode"
    ? await fetchShowByReference(imdb) : await fetchMovieByReference(imdb);
  if(tmdb) byTmdb=await lookupTmdbByType(tmdb,kind);
  // When both IDs are given, require both independently resolve to SAME media.
  if((imdb&&!byImdb)||(tmdb&&!byTmdb))return null;
  if(byImdb && byTmdb &&
    Number(byImdb.ids&&byImdb.ids.trakt)!==Number(byTmdb.ids&&byTmdb.ids.trakt))
    return null;
  var item=byImdb||byTmdb;
  if(!item||!item.ids||!Number(item.ids.trakt)||!String(item.title||"").trim())
    return null;
  if(imdb&&item.ids.imdb&&String(item.ids.imdb).toLowerCase()!==imdb)return null;
  if(tmdb&&item.ids.tmdb&&Number(item.ids.tmdb)!==tmdb)return null;
  // When S/E came from a filename rather than the provider's structured
  // position, independently verify the filename show title matches the show
  // returned by its IMDb/TMDB ID. Otherwise manual confirmation is required.
  if(kind==="episode"&&identity.positionSource==="parsed-episode"&&
     !titleIdentityMatches(identity.expectedShowTitle,item.title))return null;
  var result={kind:kind,trakt:Number(item.ids.trakt),
    title:String(item.title),year:Number(item.year)||null,
    imdb:imdb||String(item.ids.imdb||""),tmdb:tmdb||Number(item.ids.tmdb||0),
    source:imdb&&tmdb?"verified-dual-id":imdb?"verified-imdb":"verified-tmdb"};
  if(kind==="episode") {
    var checked=await verifyEpisodeCandidate(result.trakt,{
      showTitle:result.title,season:identity.season,episode:identity.episode,
      episodeTitle:""
    });
    if(!checked)return null;
    result.season=identity.season;
    result.episode=identity.episode;
    result.episodeTitle=String(checked.episode.title||"");
  }
  return result;
}

// READ-ONLY preflight. A missing checkpoint is distinct from network failure.
// Result is tied to exact Trakt movie ID or show ID + season/episode, never
// to an episode title or the filename. No remote sync modifications.
async function getResumeCheckpoint(mediaInfo) {
  if (!mediaInfo || !["movie","episode"].includes(mediaInfo.type)) {
    return {status:"unavailable",reason:"missing-media"};
  }
  var ids=await getTraktIds(mediaInfo);
  var traktId=Number(ids&&ids.trakt||0);
  if(!Number.isInteger(traktId)||traktId<=0)
    return {status:"unavailable",reason:"unverified-id"};
  var isEpisode=mediaInfo.type==="episode";
  var response=await authedRequest("GET",
    isEpisode?"/sync/playback/episodes":"/sync/playback/movies");
  if(response.statusCode!==200||!Array.isArray(response.body))
    return {status:"unavailable",reason:"Trakt resume GET "+response.statusCode};
  var matches=response.body.filter(function(entry){
    if(!entry||typeof entry!=="object")return false;
    if(isEpisode){
      var showId=Number(entry.show&&entry.show.ids&&entry.show.ids.trakt||0);
      var ep=entry.episode||{};
      return showId===traktId &&
        Number(ep.season)===Number(mediaInfo.season) &&
        Number(ep.number)===Number(mediaInfo.episode);
    }
    return Number(entry.movie&&entry.movie.ids&&entry.movie.ids.trakt||0)===traktId;
  });
  if(!matches.length)return {status:"ok",progress:null,traktId:traktId};
  var progress=matches.map(function(x){return Number(x.progress);});
  if(progress.some(function(x){return !Number.isFinite(x)||x<0||x>100;}))
    return {status:"unavailable",reason:"invalid-resume-progress"};
  // Take greatest remaining playback checkpoint to prevent regressions when
  // Trakt contains multiple entries for the same show+episode.
  return {status:"ok",progress:Math.max.apply(Math,progress),traktId:traktId};
}

async function getTraktIds(mediaInfo) {
	var type = mediaInfo && mediaInfo.type;
	if (type !== "movie" && type !== "episode") {
		return null;
	}

	var cache = loadSearchCache();
	var title =
		type === "episode"
			? mediaInfo.showTitle || mediaInfo.title
			: mediaInfo.title;
	var year = mediaInfo.year || "";
	var bucket = type === "episode" ? cache.show : cache.movie;
	var key = mediaCacheKey(mediaInfo);
	if (type === "movie" && mediaInfo.identitySource === "aiostreams-title-fragment") {
		return resolveAiosMovieIds(mediaInfo, bucket, key + "|aios:movie");
	}
	if (type === "episode" && mediaInfo.identitySource === "aiostreams-title-fragment") {
		// Each episode must be independently verified, not only the show.
		var scopedKey = key + "|aios:S" + Number(mediaInfo.season) +
			"E" + Number(mediaInfo.episode);
		return resolveAiosEpisodeIds(mediaInfo, bucket, scopedKey);
	}
	var cached = bucket[key];
	var cachedId = readCachedTraktId(cached);

	// A verified explicit Trakt ID must override an old negative title cache:
	// the previous filename or localized title may have been unresolvable.
	var explicitId=Number(mediaInfo.manualTraktId||0);
	if ((cached === 0 || cached === -1 || cachedId === -1) && !(explicitId>0)) {
		return null;
	}
	if (type === "episode") {
		return resolveEpisodeIds(mediaInfo, bucket, key);
	}
	// A previously confirmed stop carries its verified Trakt ID even when
	// local search caches were reset. Re-check it before POST, never blind-send.
	var replayId=Number(mediaInfo.manualTraktId||0);
	if (Number.isInteger(replayId) && replayId>0) {
		if (cachedId===replayId && cached && typeof cached==="object" &&
			(cached.manual || cached.titleVerified || cached.imdbVerified))
			return {trakt:replayId};
		var replayMovie=await fetchMovieByReference(replayId);
		if (!replayMovie || !titleIdentityMatches(title,replayMovie.title)) return null;
		bucket[key]={trakt:replayId,titleVerified:true};
		saveSearchCache();
		return {trakt:replayId};
	}
	if (cachedId > 0) {
		if (cached && typeof cached === "object" &&
			(cached.manual === true || cached.titleVerified === true || cached.imdbVerified === true)) {
			return { trakt: cachedId };
		}
		// Legacy numeric cache may hold an unrelated top Trakt result.
		// Revalidate title once; do not silently replay a known false positive.
		var oldMatch = await fetchMovieByReference(cachedId);
		if (oldMatch && oldMatch.title && titleIdentityMatches(title, oldMatch.title)) {
			bucket[key] = { trakt: cachedId, titleVerified: true };
			saveSearchCache();
			return { trakt: cachedId };
		}
		delete bucket[key];
		saveSearchCache();
		log("Rejected legacy movie cache due to title mismatch: " + String(title || ""));
	}

	var imdb = String(mediaInfo.imdb || "").trim().toLowerCase();
	if (type === "movie" && /^tt\d{6,10}$/.test(imdb)) {
		var identifiedMovie = await fetchMovieByReference(imdb);
		if (identifiedMovie && identifiedMovie.ids && identifiedMovie.ids.trakt) {
			var directId = Number(identifiedMovie.ids.trakt);
			bucket[key] = { trakt: directId, imdbVerified: true };
			saveSearchCache();
			log("Trakt resolved movie by IMDb reference " + imdb);
			return { trakt: directId };
		}
	}

	var requiredType = type === "episode" ? "show" : "movie";
	var results = await search(title, requiredType, year || undefined);

	if ((!results || !results.length) && year) {
		results = await search(title, requiredType, undefined);
	}

	if (!results || !results.length) {
		bucket[key] = -1;
		saveSearchCache();
		return null;
	}

	var first = results[0] || {};
	var score = Number(first.score || 0);
	if (
		score < SEARCH_SCORE_THRESHOLD ||
		!first[requiredType] ||
		!first[requiredType].ids
	) {
		bucket[key] = -1;
		saveSearchCache();
		return null;
	}

	if (type === "movie" &&
		!titleIdentityMatches(title, first[requiredType].title)) {
		log("Trakt search result rejected: requested title and top candidate do not match.");
		// Do not negative-cache localization: Manual Match remains available.
		return null;
	}

	var traktId = Number(first[requiredType].ids.trakt || 0);
	if (!traktId) {
		bucket[key] = -1;
		saveSearchCache();
		return null;
	}

	bucket[key] = { trakt: traktId, titleVerified: true };
	saveSearchCache();
	return { trakt: traktId };
}

async function prepareScrobblePayload(mediaInfo) {
	var ids = await getTraktIds(mediaInfo);
	if (!ids) {
		return null;
	}

	if (mediaInfo.type === "movie") {
		return {
			movie: {
				ids: ids,
			},
		};
	}

	if (!mediaInfo.season || !mediaInfo.episode) {
		return null;
	}

	return {
		show: {
			ids: ids,
		},
		episode: {
			season: Number(mediaInfo.season),
			number: Number(mediaInfo.episode),
		},
	};
}

async function scrobble(verb, mediaInfo, progress) {
	// Never perform Trakt metadata lookups for an event that is already
	// ineligible to scrobble (e.g. a stop below 1%).
	var initialProgress = Number(progress || 0);
	var initialVerb = normalizeScrobbleVerb(verb, initialProgress);
	if (shouldSkipEarlyScrobble(initialVerb, initialProgress)) {
		log("Skipping Trakt " + initialVerb + " below 1% progress for " +
			mediaIdentityLabel(mediaInfo) + " at " + initialProgress.toFixed(2) + "%");
		return { ok: false, skip: true, reason: earlyScrobbleReason(initialVerb) };
	}
	if (!hasCredentials()) {
		return {
			ok: false,
			skip: true,
			reason: "missing-client-credentials",
		};
	}

	var payload;
	try {
		payload = await prepareScrobblePayload(mediaInfo);
	} catch (error) {
		if (isAuthRequiredError(error)) {
			return {
				ok: false,
				skip: true,
				reason: "auth-required",
			};
		}
		throw error;
	}
	if (!payload) {
		return {
			ok: false,
			skip: true,
			reason: "missing-trakt-match",
		};
	}

	payload.progress = Number(progress || 0);
	var requestVerb = normalizeScrobbleVerb(verb, payload.progress);

	if (requestVerb !== verb) {
		log(
			"Normalizing Trakt " +
				verb +
				" to " +
				requestVerb +
				" at " +
				payload.progress.toFixed(2) +
				"% for " +
				mediaIdentityLabel(mediaInfo),
		);
	}

	if (shouldSkipEarlyScrobble(requestVerb, payload.progress)) {
		log(
			"Skipping Trakt " +
				requestVerb +
				" below 1% progress for " +
				mediaIdentityLabel(mediaInfo) +
				" at " +
				payload.progress.toFixed(2) +
				"%",
		);
		return {
			ok: false,
			skip: true,
			reason: earlyScrobbleReason(requestVerb),
		};
	}
	var response;
	try {
		response = await authedRequest(
			"POST",
			"/scrobble/" + requestVerb,
			{
				body: payload,
			},
		);
	} catch (error) {
		if (isAuthRequiredError(error)) {
			return {
				ok: false,
				skip: true,
				reason: "auth-required",
			};
		}
		throw error;
	}

	if (response.statusCode === 404) {
		return {
			ok: false,
			notFound: true,
			body: response.body,
		};
	}

	if (response.statusCode === 409) {
		return {
			ok: false,
			duplicate: true,
			body: response.body,
		};
	}

	if (response.statusCode >= 400) {
		log(
			"Trakt scrobble HTTP " +
				response.statusCode +
				" verb=" +
				requestVerb +
				" payload=" +
				summarizeBody(payload) +
				" body=" +
				(response.rawBody || summarizeBody(response.body)),
		);
		var error = new Error(
			response.body.error_description ||
				response.body.error ||
				response.rawBody ||
				"Trakt scrobble failed with status " + response.statusCode,
		);
		error.statusCode = response.statusCode;
		error.responseBody = response.body;
		error.responseRawBody = response.rawBody;
		error.requestPayload = payload;
		error.scrobbleVerb = requestVerb;
		throw error;
	}

	return {
		ok: true,
		verb: requestVerb,
		// Resolved by Trakt before POST; not inferred from filename or user-supplied labels.
		resolvedTraktId: Number(payload.show && payload.show.ids && payload.show.ids.trakt ||
			payload.movie && payload.movie.ids && payload.movie.ids.trakt || 0),
		action:
			response.body && response.body.action
				? String(response.body.action)
				: requestVerb,
		progress:
			response.body && isFinite(Number(response.body.progress))
				? Number(response.body.progress)
				: Number(progress || 0),
		body: response.body,
	};
}

function signOut() {
	clearToken();
	return getAuthStatus();
}

module.exports = {
	applyMatchOverride: applyMatchOverride,
	beginInteractiveAuth: beginInteractiveAuth,
	configure: configure,
	clearToken: clearToken,
	clearRecentHistoryCache: clearRecentHistoryCache,
	getAuthStatus: getAuthStatus,
	getApiStatus: getApiStatus,
	getRecentHistory: getRecentHistory,
	getTokenInfo: getTokenInfo,
	getViewerProfile: getViewerProfile,
	hasCredentials: hasCredentials,
	isAuthRequiredError: isAuthRequiredError,
	signOut: signOut,
	usingEmbeddedCredentials: usingEmbeddedCredentials,
	ensureAccessToken: ensureAccessToken,
	getTraktIds: getTraktIds,
	getResumeCheckpoint: getResumeCheckpoint,
	resolveFreshIdentity: resolveFreshIdentity,
	normalizeScrobbleVerb: normalizeScrobbleVerb,
	prepareScrobblePayload: prepareScrobblePayload,
	lookupCorrectionReference: lookupCorrectionReference,
	searchCorrectionCandidates: searchCorrectionCandidates,
	scrobble: scrobble,
	copyPendingAuthCode: copyPendingAuthCode,
};
