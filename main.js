const { core, event, file, preferences, utils, sidebar, menu } = iina;

var parser = require("./parser.iina.js");
var streamSource = require("./stream-source.js");
var playbackIdentity = require("./playback-identity.js");
var monitor = require("./monitor.js");
var stopJournalModule = require("./stop-journal.js");
var syncHistoryModule = require("./sync-history.js");
var playbackDiagnostics = require("./playback-diagnostics.js");
var mediaFusion = require("./mediafusion-identity.js");
var freshIdentity = require("./fresh-identity.js");
var resumeProtection = require("./resume-protection.js");
var correctionMedia = require("./correction-media.js");
var trakt = require("./trakt.js");
var debugLogBuffer = require("./debug-log-buffer.js");
var PLUGIN_VERSION = "0.2.6-beta.1";
var DEBUG_LOG_PATH = "@data/debug.log";
var MAX_DEBUG_LOG_CHARS = 200000;
var DEBUG_LOG_FLUSH_INTERVAL_MS = 10000;
var POLL_INTERVAL_MS = 2000;
var UI_POLL_INTERVAL_MS = 2000;
// Limit playback-position-triggered WebView refreshes; keep event transitions instant.
var PLAYBACK_SIDEBAR_MIN_INTERVAL_MS = 1000;
var PLUGIN_SIDEBAR_ID = "plugin:io.github.olivergiangvu.iinatraktscrobblerplus";
var currentMedia = null;
var lastSourceSignature = "";
var playbackState = createPlaybackState();
var pollTimer = null;
var uiPollTimer = null;
var lastPlaybackSidebarRefreshAt = 0;
var sidebarHandlersBound = false;
var firstScrobbleNoticeShown = false;
var missingCredentialsNoticeShown = false;
var authRequiredNoticeShown = false;
var guessitFailureLogged = false;
var lastHandledAuthActionNonce = "";
var lastAuthStatusSignature = "";
var authActionChain = Promise.resolve();
var sidebarRefreshActive = false;
var sidebarRefreshForced = false;
var stopReplayActive = false;
var stopReplayTimer = null;
var lastScrobbleStatus = createScrobbleStatus();
var correctionState = createCorrectionState();
var stopJournal = stopJournalModule.create(file);
var syncHistory = syncHistoryModule.create(file);
var debugLog = debugLogBuffer.create(file, {
  path: DEBUG_LOG_PATH,
  maxChars: MAX_DEBUG_LOG_CHARS,
  thresholdChars: 8192
});
var mediaFusionShowCache = mediaFusion.create(file);
var activeStopSyncId = "";
var syncQueueNotice = "";
var confirmedPlayback = {key:"",proof:null};

function createPlaybackState() {
  return {
    prevSnapshot: null,
    preview: false,
    fastPause: false,
    scrobbleBuffer: null,
    previewTimer: null,
    fastPauseTimer: null,
    lastScrobbleKey: "",
    scrobbleChain: Promise.resolve()
  };
}

function createScrobbleStatus() {
  return {
    status: "idle",
    verb: "",
    action: "",
    mediaLabel: "",
    detail: "No scrobble has been attempted in this window yet.",
    reason: "",
    progress: null,
    updatedAt: ""
  };
}

function createCorrectionState() {
  return {
    active: false,
    busy: false,
    query: "",
    reference: "",
    error: "",
    mediaLabel: "",
    mediaKey: "",
    kind: "movie",
    season: "",
    episode: "",
    results: []
  };
}

trakt.configure({
  file: file,
  preferences: preferences,
  utils: utils,
  logger: function(message) {
    log(message);
  },
  notify: function(message) {
    importantOsd(message);
  }
});

function appendDebugLog(message) {
  debugLog.append(message);
}

function log(message) {
  iina.console.log("[IINATraktScrobbler] " + message);
  appendDebugLog("[IINATraktScrobbler] " + message);
}

function errStr(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function logGuessitFailureOnce() {
  if (guessitFailureLogged || !parser || typeof parser.getDiagnostics !== "function") return;

  var diagnostics = parser.getDiagnostics();
  if (!diagnostics) return;
  if (
    diagnostics.guessitStatus !== "load-failed" &&
    diagnostics.guessitStatus !== "unconfigured" &&
    diagnostics.guessitStatus !== "runtime-failed"
  ) return;

  guessitFailureLogged = true;
  if (diagnostics.guessitStatus === "runtime-failed") {
    log("Guessit runtime failed: " + diagnostics.guessitError);
    return;
  }

  log("Guessit unavailable: " + diagnostics.guessitLoadError);
}

function prefBool(key, fallbackValue) {
  var value = preferences.get(key);
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallbackValue;
}

function prefNumber(key, fallbackValue) {
  var value = Number(preferences.get(key));
  return isFinite(value) ? value : fallbackValue;
}

function debugOsd(message) {
  if (!prefBool("debug_osd", false)) return;
  try {
    core.osd("Trakt Scrobbler: " + message);
  } catch (_error) {}
}

function statusOsd(message) {
  if (!prefBool("status_osd", true)) return;
  try {
    core.osd(message);
  } catch (_error) {}
}

function importantOsd(message) {
  try {
    core.osd("Trakt Scrobbler: " + message);
  } catch (_error) {}
}

function successfulScrobbleAction(verb, result) {
  if (result && result.action) {
    return String(result.action);
  }
  return verb;
}

function successfulScrobbleProgress(payloadProgress, result) {
  if (result && isFinite(Number(result.progress))) {
    return Number(result.progress);
  }
  return Number(payloadProgress || 0);
}

function successfulScrobbleDetail(action, progress) {
  var value = Number(progress || 0);
  if (!isFinite(value)) value = 0;
  if (action === "scrobble") return "Trakt marked this as watched at " + value.toFixed(2) + "%.";
  if (action === "pause") return "Trakt saved playback progress at " + value.toFixed(2) + "%.";
  if (action === "start") return "Trakt accepted playback at " + value.toFixed(2) + "%.";
  return "Trakt accepted this scrobble at " + value.toFixed(2) + "%.";
}

function truncateOsdText(value, maxLength) {
  var text = String(value || "").trim();
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trim() + "…";
}

function osdMediaLabel(mediaInfo) {
  if (!mediaInfo) return "";

  if (mediaInfo.type === "episode") {
    var episodeCode = "S" + pad2(mediaInfo.season) + "E" + pad2(mediaInfo.episode);
    if (mediaInfo.episodeTitle) {
      return truncateOsdText(episodeCode + " - " + mediaInfo.episodeTitle, 64);
    }
    return truncateOsdText((mediaInfo.showTitle || mediaInfo.title || "") + " " + episodeCode, 64);
  }

  return truncateOsdText(mediaInfo.title + (mediaInfo.year ? (" (" + mediaInfo.year + ")") : ""), 64);
}

function showScrobbleStatusOsd(title, mediaInfo) {
  if (!prefBool("status_osd", true)) return;

  var message = String(title || "").trim();
  var label = osdMediaLabel(mediaInfo);
  if (label) {
    message += ": " + label;
  }

  statusOsd(message);
}

function maybeShowScrobbleStatusOsd(verb, action, mediaInfo) {
  if (action === "scrobble") {
    showScrobbleStatusOsd("Watched on Trakt", mediaInfo);
    return;
  }

  if (action === "pause") {
    showScrobbleStatusOsd("Progress Saved", mediaInfo);
    return;
  }

  if (verb === "start") {
    showScrobbleStatusOsd("Scrobble Started", mediaInfo);
    return;
  }

  if (verb === "stop") {
    showScrobbleStatusOsd("Stopped on Trakt", mediaInfo);
  }
}

function setStatusOsdEnabled(enabled) {
  var nextValue = !!enabled;
  var prevValue = prefBool("status_osd", true);
  if (nextValue === prevValue) {
    queueSidebarRefresh(false);
    return;
  }

  persistPreferences({
    status_osd: nextValue
  });

  log("Trakt status OSD " + (nextValue ? "enabled" : "disabled"));
  queueSidebarRefresh(false);
}

function persistPreferences(values) {
  Object.keys(values || {}).forEach(function(key) {
    preferences.set(key, values[key]);
  });

  if (typeof preferences.sync === "function") {
    try {
      preferences.sync();
    } catch (_error) {}
  }
}

function authStatusSignature(status) {
  return JSON.stringify({
    state: status.state,
    summary: status.summary,
    detail: status.detail,
    busy: !!status.busy,
    connected: !!status.connected,
    credentialMode: status.credentialMode
  });
}

function persistAuthStatus(status) {
  var resolved = status || trakt.getAuthStatus();
  var signature = authStatusSignature(resolved);
  var payload = {
    auth_state: resolved.state,
    auth_summary: resolved.summary,
    auth_detail: resolved.detail || "",
    auth_busy: !!resolved.busy,
    auth_connected: !!resolved.connected,
    auth_credential_mode: resolved.credentialMode || ""
  };

  if (signature !== lastAuthStatusSignature) {
    payload.auth_updated_at = new Date().toISOString();
    lastAuthStatusSignature = signature;
  }

  persistPreferences(payload);
  return resolved;
}

function stateName(state) {
  if (state === monitor.State.Playing) return "playing";
  if (state === monitor.State.Paused) return "paused";
  if (state === monitor.State.Stopped) return "stopped";
  return core.status.idle ? "idle" : (core.status.paused ? "paused" : "playing");
}

function cloneScrobbleStatus(status) {
  return {
    status: status.status,
    verb: status.verb,
    action: status.action,
    mediaLabel: status.mediaLabel,
    detail: status.detail,
    reason: status.reason,
    progress: status.progress,
    updatedAt: status.updatedAt
  };
}

function cloneCorrectionState(state) {
  var source = state || createCorrectionState();
  return {
    active: !!source.active,
    busy: !!source.busy,
    query: String(source.query || ""),
    reference: String(source.reference || ""),
    error: String(source.error || ""),
    mediaLabel: String(source.mediaLabel || ""),
    mediaKey: String(source.mediaKey || ""),
    kind: source.kind === "episode" ? "episode" : "movie",
    season: String(source.season !== undefined && source.season !== null ? source.season : ""),
    episode: String(source.episode !== undefined && source.episode !== null ? source.episode : ""),
    results: Array.isArray(source.results)
      ? source.results.map(function(result) {
          return {
            trakt: Number(result.trakt || 0),
            kind: String(result.kind || ""),
            title: String(result.title || ""),
            subtitle: String(result.subtitle || ""),
            detail: String(result.detail || ""),
            year: result.year ? Number(result.year) : null,
            posterUrl: String(result.posterUrl || "")
          };
        })
      : []
  };
}

function setScrobbleStatus(values) {
  var incoming = values || {};
  var next = Object.assign({}, lastScrobbleStatus, incoming);
  if (!Object.prototype.hasOwnProperty.call(incoming, "reason") &&
      incoming.status !== "skipped" &&
      incoming.status !== "disabled") {
    next.reason = "";
  }
  if (!Object.prototype.hasOwnProperty.call(incoming, "action")) {
    next.action = "";
  }

  lastScrobbleStatus = Object.assign({}, next, {
    updatedAt: new Date().toISOString()
  });
  queueSidebarRefresh(false);
}

function showSidebarTab() {
  try {
    if (sidebar && typeof sidebar.show === "function") {
      sidebar.show();
      return;
    }
  } catch (_error) {}

  try {
    if (core.window) {
      core.window.sidebar = PLUGIN_SIDEBAR_ID;
    }
  } catch (_error) {}
}

function registerMenuItems() {
  if (!menu || typeof menu.addItem !== "function" || typeof menu.item !== "function") {
    return;
  }

  menu.addItem(menu.item("Show Sidebar", function() {
    showSidebarTab();
  }, {
    keyBinding: "Meta+t"
  }));
}

function currentResumeStatus() {
  if (!currentMedia)
    return {status:"idle",blocked:false,canRestore:false,message:""};
  if (!currentMedia.resumeGate)
    return Object.assign({blocked:true,canRestore:false},
      resumeProtection.pendingIdentityStatus(currentMedia.mediaInfo,currentMedia.freshState));
  var state=currentMedia.resumeGate.snapshot();
  var position=Number(core.status.position||0);
  var duration=Number(core.status.duration||0);
  var local=duration>0?monitor.computeProgress(position,duration):null;
  var result=currentMedia.resumeGate.decision(local);
  var protectedResume=result.blocked && result.reason==="remote-ahead";
  return {status:protectedResume?"protected":state.status,
    blocked:result.blocked,canRestore:protectedResume && duration>0,
    resumePercent:state.resumePercent,
    localPercent:local,
    message:protectedResume
      ? "Trakt holds "+state.resumePercent.toFixed(1)+"%; IINA is at "+
        (local===null?"unknown":local.toFixed(1))+
        "%. Outgoing scrobbles are blocked to preserve resume."
      : state.message};
}
function beginResumeCheck(target) {
  if (!target || !target.mediaInfo || target.mediaInfo.unresolvedShow ||
      (target.mediaInfo.type==="episode" &&
       /^unknown series$/i.test(String(target.mediaInfo.showTitle||""))) ||
      ["resolving","conflict","rejected"].includes(target.freshState)) return;
  var gate=resumeProtection.create();
  target.resumeGate=gate;
  var inspectedInfo=target.mediaInfo;
  queueSidebarRefresh(false);
  (async function() {
    var result;
    try {result=await trakt.getResumeCheckpoint(inspectedInfo);}
    catch(error) {
      result={status:"unavailable"};
      log("Trakt resume preflight unavailable: "+errStr(error));
    }
    // The playback, corrected identity or preflight may have changed mid-request.
    if(currentMedia!==target || target.resumeGate!==gate ||
       target.mediaInfo!==inspectedInfo)return;
    gate.update(result);
    var current=currentResumeStatus();
    log("Resume guard: "+current.status+"; "+current.message);
    queueSidebarRefresh(false);
    if (!current.blocked) {
      resyncCurrentPlayback("Trakt resume preflight cleared; safe to scrobble");
    }
  })();
}
function restoreRemoteResume() {
  if (!currentMedia || !currentMedia.resumeGate) return;
  var gate=currentMedia.resumeGate, snapshot=buildLiveSnapshot();
  if (!snapshot || snapshot.state===monitor.State.Stopped)return;
  var check=gate.decision(snapshot.progress);
  if (!check.blocked || check.reason!=="remote-ahead" ||
      !Number.isFinite(check.resumePercent))return;
  var target=Math.min(snapshot.duration-2,
    snapshot.duration*check.resumePercent/100);
  if(!Number.isFinite(target)||target<=0)return;
  try {
    core.seekTo(target);
    log("User-initiated resume seek from Trakt progress "+check.resumePercent.toFixed(1)+"%");
    queueSidebarRefresh(false);
  }catch(error){
    log("Resume seek unavailable: "+errStr(error));
    importantOsd("Could not seek to Trakt resume position");
  }
}

function buildSidebarPlayback() {
  var snapshot = buildLiveSnapshot();
  return {
    available: !!(currentMedia && currentMedia.mediaInfo),
    mediaLabel: currentMedia && currentMedia.mediaInfo ? mediaLabel(currentMedia.mediaInfo) : "",
    parserSource: currentMedia && currentMedia.parsed ? (currentMedia.parsed.parserSource || "") : "",
    state: snapshot ? stateName(snapshot.state) : stateName(null),
    progress: snapshot ? snapshot.progress : 0,
    position: snapshot ? snapshot.position : 0,
    duration: snapshot ? snapshot.duration : 0,
    preview: !!playbackState.preview,
    fastPause: !!playbackState.fastPause,
    matchProvenance: determineMatchProvenance(),
    resumeProtection: currentResumeStatus(),
    identifiedAt: currentMedia ? currentMedia.identifiedAt : ""
  };
}

function determineMatchProvenance() {
  if (!currentMedia || !currentMedia.mediaInfo) return {code:"unknown",label:"Unidentified"};
  var info=currentMedia.mediaInfo;
  var source=String(currentMedia.parsed && currentMedia.parsed.parserSource || "");
  if (currentMedia.freshState==="resolving") return {code:"fresh-pending",label:"Verifying External ID…"};
  if (info.unresolvedShow) return {code:"needs-manual",label:"Needs Manual Match"};
  if (source==="mediafusion-confirmed-pack") return {code:"confirmed-pack",label:"Confirmed Pack Cache"};
  if (currentMedia.freshState==="verified") {
    return {code:"fresh-verified",label:
      currentMedia.freshIdKind==="verified-dual-id"?"Fresh IMDb + TMDB (verified)":
      currentMedia.freshIdKind==="verified-tmdb"?"Fresh TMDB ID (verified)":
      "Fresh IMDb ID (verified)"};
  }
  if (currentMedia.freshState==="rejected" || currentMedia.freshState==="conflict")
    return {code:"fresh-rejected",label:"External ID needs review"};
  if (currentMedia.manuallyCorrected) return {code:"manual",label:"Manual Confirmed"};
  if (source==="aiostreams-title-fragment") return confirmedPlayback.key===monitor.mediaKey(info)
    ? {code:"aiostreams-confirmed",label:"AIOStreams Title (Trakt Exact)"}
    : {code:"aiostreams-pending",label:"AIOStreams Title (checking)"};
  if (/^tt\d{6,10}$/i.test(String(info.imdb||""))) return {code:"imdb",label:"Direct IMDb ID"};
  if (confirmedPlayback.key===monitor.mediaKey(info)) return {code:"trakt-confirmed",label:"Trakt Verified"};
  if (/^(?:mpv-|filename|stream-)/i.test(source)) return {code:"filename",label:"Filename / Metadata (unverified)"};
  return {code:"unverified",label:"Unverified Metadata"};
}
function trustedReplayProof(info) {
  if (!info || info.unresolvedShow) return null;
  var id=Number(info.manualTraktId||0);
  if (Number.isInteger(id)&&id>0) return {
    kind:currentMedia&&currentMedia.freshState==="verified"&&
      currentMedia.mediaInfo===info?"trakt-confirmed":"manual",traktId:id
  };
  if (/^tt\d{6,10}$/i.test(String(info.imdb||""))) return {kind:"imdb",imdb:info.imdb};
  if (confirmedPlayback.key===monitor.mediaKey(info)&&confirmedPlayback.proof)
    return confirmedPlayback.proof;
  return null;
}

function isSyncReplayPlaybackActive() {
  return !!(currentMedia && playbackState.prevSnapshot &&
    playbackState.prevSnapshot.state !== monitor.State.Stopped);
}

// Sidebar gets only bounded metadata from the final-stop journal.
function buildSyncQueueStatus() {
  var api = trakt.getApiStatus ? trakt.getApiStatus() : {mode:"online"};
  var isActive = isSyncReplayPlaybackActive();
  var pending = stopJournal.pending().map(function(entry) {
    return {
      id: entry.id,
      label: mediaLabel(entry.mediaInfo),
      progress: Number(entry.progress || 0),
      queuedAt: new Date(entry.createdAt).toISOString(),
      syncing: entry.id === activeStopSyncId
    };
  });
  var needsReview=stopJournal.review().map(function(entry) {
    return {id:entry.id,label:mediaLabel(entry.mediaInfo),progress:entry.progress,
      queuedAt:new Date(entry.createdAt).toISOString(),
      reason:entry.reviewReason || (entry.mediaInfo && (entry.mediaInfo.unresolvedShow ||
        /^unknown series$/i.test(String(entry.mediaInfo.showTitle||"")))
        ? "Missing verified series" : "Legacy checkpoint: match unverified")};
  });
  return {
    pending: pending,
    needsReview: needsReview,
    recentlySynced: syncHistory.recent(),
    flushing: !!stopReplayActive,
    activeSyncId: activeStopSyncId,
    notice: syncQueueNotice,
    canRetry: !!pending.length && api.mode === "online" &&
      !stopReplayActive && !activeStopSyncId && !isActive &&
      isScrobblingEnabled() && trakt.getAuthStatus().connected,
    blockedReason: isActive ? "Pause/stop the current playback first."
      : api.mode !== "online" ? "Respecting Trakt cooldown."
      : stopReplayActive || activeStopSyncId ? "Another sync is running."
      : !isScrobblingEnabled() ? "Enable scrobbling first."
      : !trakt.getAuthStatus().connected ? "Sign in to Trakt first." : ""
  };
}

async function buildSidebarPayload(forceProfileRefresh) {
  var auth = persistAuthStatus();
  var viewerProfile = null;
  var correction = cloneCorrectionState(correctionState);
  var recentHistory = {
    items: [],
    fetchedAt: "",
    error: ""
  };

  if (auth.connected && typeof trakt.getViewerProfile === "function") {
    try {
      viewerProfile = await trakt.getViewerProfile({
        force: !!forceProfileRefresh
      });
    } catch (error) {
      log("Sidebar profile refresh failed: " + errStr(error));
    }
  }

  if (auth.connected && !correction.active && typeof trakt.getRecentHistory === "function") {
    recentHistory = await trakt.getRecentHistory({
      force: !!forceProfileRefresh
    });
  }

  return {
    app: {
      version: PLUGIN_VERSION
    },
    scrobblingEnabled: prefBool("scrobble_enabled", true),
    statusOsdEnabled: prefBool("status_osd", true),
    auth: {
      state: auth.state,
      summary: auth.summary,
      detail: auth.detail || "",
      busy: !!auth.busy,
      connected: !!auth.connected,
      credentialMode: auth.credentialMode || "",
      deviceCode: auth.deviceCode || "",
      verificationUrl: auth.verificationUrl || "",
      token: typeof trakt.getTokenInfo === "function" ? trakt.getTokenInfo() : null,
      user: viewerProfile
    },
    playback: buildSidebarPlayback(),
    scrobble: cloneScrobbleStatus(lastScrobbleStatus),
    correction: correction,
    history: recentHistory,
    network: Object.assign({}, (trakt.getApiStatus ? trakt.getApiStatus() : {mode:"online"}), {
      pendingFinalizations: stopJournal.pending().length
    }),
    syncQueue: buildSyncQueueStatus(),
    generatedAt: new Date().toISOString()
  };
}

function queueSidebarRefresh(forceProfileRefresh) {
  if (!sidebar || typeof sidebar.postMessage !== "function") return;
  // One in-flight refresh; coalesce fast playback/UI events rather than
  // accumulating hundreds of async sidebar tasks during network stalls.
  if (forceProfileRefresh) sidebarRefreshForced = true;
  if (sidebarRefreshActive) return;
  sidebarRefreshActive = true;
  var force = sidebarRefreshForced;
  sidebarRefreshForced = false;
  (async function() {
    try {
      var payload = await buildSidebarPayload(force);
      sidebar.postMessage("state", payload);
    } catch (error) {
      log("Sidebar refresh failed: " + errStr(error));
    } finally {
      sidebarRefreshActive = false;
      if (sidebarRefreshForced) queueSidebarRefresh(false);
    }
  })();
}

function bindSidebarMessaging() {
  if (sidebarHandlersBound || !sidebar || typeof sidebar.onMessage !== "function") {
    return;
  }

  sidebarHandlersBound = true;

  sidebar.onMessage("ready", function() {
    log("Sidebar ready");
    queueSidebarRefresh(true);
  });

  sidebar.onMessage("connect", function() {
    log("Sidebar requested connect");
    authActionChain = authActionChain.then(async function() {
      var force = trakt.getAuthStatus().state === "connected";
      await runManualAuth(force);
    }).catch(function(error) {
      log("Sidebar connect failed: " + errStr(error));
      persistAuthStatus();
      queueSidebarRefresh(true);
    });
  });

  sidebar.onMessage("signout", function() {
    log("Sidebar requested signout");
    authActionChain = authActionChain.then(function() {
      handleManualSignOut();
    }).catch(function(error) {
      log("Sidebar signout failed: " + errStr(error));
      persistAuthStatus();
      queueSidebarRefresh(true);
    });
  });

  sidebar.onMessage("toggle_scrobbling", function(payload) {
    var enabled = !(payload && payload.enabled === false);
    log("Sidebar requested scrobbling " + (enabled ? "enable" : "disable"));
    setScrobblingEnabled(enabled);
  });

  sidebar.onMessage("toggle_status_osd", function(payload) {
    var enabled = !(payload && payload.enabled === false);
    log("Sidebar requested status OSD " + (enabled ? "enable" : "disable"));
    setStatusOsdEnabled(enabled);
  });

  sidebar.onMessage("refresh", function() {
    log("Sidebar requested refresh");
    queueSidebarRefresh(true);
  });

  sidebar.onMessage("copy_playback_diagnostics", function() {
    (async function() {
      try {
        var text = JSON.stringify(JSON.parse(playbackDiagnostics.build(
          getCurrentSource(),
          currentMedia && currentMedia.parsed,
          currentMedia && currentMedia.traktTargetLabel,
          PLUGIN_VERSION
        )));
        // AppleScript clipboard helper, same IINA-sanctioned interface used by auth.
        var escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
          .replace(/\r/g, " ").replace(/\n/g, "\\n");
        var result = await utils.exec("/usr/bin/osascript", [
          "-e", 'set the clipboard to "' + escaped + '"'
        ]);
        var ok = result && result.status === 0;
        sidebar.postMessage("diagnostics_copy_status", {
          ok: !!ok,
          message: ok ? "Safe diagnostics copied. Paste them into ChatGPT." :
            "Copy failed. Try again."
        });
      } catch (error) {
        log("Safe diagnostics clipboard unavailable: " + errStr(error));
        sidebar.postMessage("diagnostics_copy_status", {ok:false, message:"Clipboard unavailable."});
      }
    })();
  });

  sidebar.onMessage("discard_unverified_stop", function(payload) {
    var id=payload && typeof payload.id==="string" ? payload.id : "";
    var response={ok:false,id:id,message:"Checkpoint was preserved."};
    try {
      // Only local unverified records are eligible. Never mutate Trakt history
      // or allow this handler to remove a proof-backed pending stop.
      if (!id) {
        response.message="Missing checkpoint identifier.";
      } else if (!stopJournal.review().some(function(x){return x.id===id;})) {
        response.message="Item no longer needs review, or was already removed.";
      } else if (stopJournal.discardReview(id)) {
        response.ok=true;
        response.message="Unverified LOCAL checkpoint removed.";
        syncQueueNotice=response.message;
        log("Removed one unverified stop by confirmed user action");
      } else {
        response.message="Failed to save local queue; checkpoint is unchanged.";
      }
    } catch (error) {
      response.message="Removal failed; checkpoint was preserved.";
      log("Local checkpoint removal failed: "+errStr(error));
    }
    try { sidebar.postMessage("discard_unverified_result",response); }
    catch (error) { log("Unable to notify sidebar about removal: "+errStr(error)); }
    queueSidebarRefresh(false);
  });

  sidebar.onMessage("restore_remote_resume", function() {
    restoreRemoteResume();
  });

  sidebar.onMessage("retry_pending_stops", function() {
    // Manual retry does not bypass server cooldown or interrupt playback.
    var q = buildSyncQueueStatus();
    if (!q.canRetry) {
      syncQueueNotice = q.blockedReason || (q.pending.length ? "Retry is not available." : "Queue is already clear.");
      queueSidebarRefresh(false);
      return;
    }
    syncQueueNotice = "Retry requested. Sending saved stops in order.";
    queueSidebarRefresh(false);
    Promise.resolve().then(async function() {
      await replaySavedFinalizations();
      var remaining = stopJournal.pending().length;
      var api = trakt.getApiStatus ? trakt.getApiStatus() : {mode:"online"};
      syncQueueNotice = remaining
        ? (api.mode === "online"
          ? remaining + " stop update(s) still pending; automatic recovery remains enabled."
          : "Trakt unavailable; retry will resume after cooldown.")
        : "All pending final stops confirmed.";
      queueSidebarRefresh(false);
    }).catch(function(error) {
      syncQueueNotice = "Retry failed; saved stops remain queued.";
      log("Manual retry failed: " + errStr(error));
      queueSidebarRefresh(false);
    });
  });

  sidebar.onMessage("copy_auth_code", function() {
    Promise.resolve().then(async function() {
      var result = { ok: false, message: "No active code." };
      if (typeof trakt.copyPendingAuthCode === "function") {
        result = await trakt.copyPendingAuthCode();
      }
      try {
        sidebar.postMessage("copy_auth_result", result);
      } catch (_error) {}
    }).catch(function(error) {
      log("Sidebar auth code copy failed: " + errStr(error));
      try {
        sidebar.postMessage("copy_auth_result", {
          ok: false,
          message: "Copy failed. Copy manually."
        });
      } catch (_error) {}
    });
  });

  sidebar.onMessage("open_correction", function(payload) {
    var query = payload && payload.query ? String(payload.query) : "";
    log("Sidebar requested correction search");
    authActionChain = authActionChain.then(function() {
      return openCorrectionFlow(query);
    }).catch(function(error) {
      log("Sidebar correction open failed: " + errStr(error));
      correctionState = Object.assign(cloneCorrectionState(correctionState), {
        active: true,
        busy: false,
        error: errStr(error)
      });
      queueSidebarRefresh(false);
    });
  });

  sidebar.onMessage("change_correction_kind", function(payload) {
    var kind = payload && payload.kind === "episode" ? "episode" : "movie";
    authActionChain = authActionChain.then(function() {
      if (!currentMedia || !currentMedia.mediaInfo || !correctionState.active) return;
      var hint = currentMedia.episodeRoute || mediaFusion.fromSource(currentMedia.source);
      var pos = correctionMedia.episodePosition(currentMedia.mediaInfo, hint);
      correctionState = Object.assign(cloneCorrectionState(correctionState), {
        kind: kind,
        busy: false,
        results: [],
        error: "",
        season: kind === "episode" ? pos.season : "",
        episode: kind === "episode" ? pos.episode : ""
      });
      queueSidebarRefresh(false);
    }).catch(function(error) {
      log("Manual media kind change failed: " + errStr(error));
    });
  });

  sidebar.onMessage("search_correction", function(payload) {
    var query = payload && payload.query ? String(payload.query) : "";
    log('Sidebar requested correction search query="' + query + '"');
    authActionChain = authActionChain.then(function() {
      return searchCorrectionFlow(query);
    }).catch(function(error) {
      log("Sidebar correction search failed: " + errStr(error));
      correctionState = Object.assign(cloneCorrectionState(correctionState), {
        active: true,
        busy: false,
        error: errStr(error)
      });
      queueSidebarRefresh(false);
    });
  });

  sidebar.onMessage("lookup_correction_reference", function(payload) {
    var reference = payload && payload.reference ? String(payload.reference) : "";
    log('Sidebar requested correction reference lookup="' + reference + '"');
    authActionChain = authActionChain.then(function() {
      return lookupCorrectionReference(reference);
    }).catch(function(error) {
      log("Sidebar correction reference lookup failed: " + errStr(error));
      correctionState = Object.assign(cloneCorrectionState(correctionState), {
        active: true,
        busy: false,
        error: errStr(error)
      });
      queueSidebarRefresh(false);
    });
  });

  sidebar.onMessage("close_correction", function() {
    log("Sidebar requested correction close");
    resetCorrectionState();
    queueSidebarRefresh(false);
  });

  sidebar.onMessage("choose_correction", function(payload) {
    var traktId = payload && payload.trakt ? Number(payload.trakt) : 0;
    var season = payload && payload.season;
    var episode = payload && payload.episode;
    if (!traktId) {
      return;
    }

    log("Sidebar requested correction apply " + traktId);
    authActionChain = authActionChain.then(function() {
      return applyCorrectionChoice(traktId, season, episode);
    }).catch(function(error) {
      log("Sidebar correction apply failed: " + errStr(error));
      correctionState = Object.assign(cloneCorrectionState(correctionState), {
        active: true,
        busy: false,
        error: errStr(error)
      });
      queueSidebarRefresh(false);
    });
  });
}

function initializeSidebar() {
  if (!sidebar || typeof sidebar.loadFile !== "function") {
    return;
  }

  sidebarHandlersBound = false;
  sidebar.loadFile("sidebar.html");
  bindSidebarMessaging();
  queueSidebarRefresh(true);
}

function wrapEvent(label, fn) {
  return async function() {
    try {
      return await fn();
    } catch (error) {
      var message = label + " failed: " + errStr(error);
      log(message);
      importantOsd(message);
    }
  };
}

function getCurrentSource() {
  function mpvText(key) {
    try {
      return iina.mpv && typeof iina.mpv.getString === "function"
        ? String(iina.mpv.getString(key) || "")
        : "";
    } catch (_error) { return ""; }
  }
  return {
    url: String(core.status.url || ""),
    title: String(core.status.title || ""),
    path: mpvText("path"),
    filename: mpvText("filename"),
    mediaTitle: mpvText("media-title"),
    metadataTitle: mpvText("metadata/by-key/title")
  };
}

async function runManualAuth(force) {
  var status = trakt.getAuthStatus();
  showSidebarTab();
  persistAuthStatus({
    state: "authorizing",
    summary: force ? "Reconnecting to Trakt" : "Waiting for Trakt authorization",
    detail: "Complete the confirmation in your browser.",
    busy: true,
    connected: false,
    credentialMode: status.credentialMode
  });
  queueSidebarRefresh(true);

  try {
    await trakt.beginInteractiveAuth({
      force: !!force,
      showDialog: true
    });
    authRequiredNoticeShown = false;
    persistAuthStatus();
    queueSidebarRefresh(true);
    resyncCurrentPlaybackAfterAuth();
    importantOsd("Trakt connected");
    log("Manual Trakt auth completed");
  } catch (error) {
    persistAuthStatus();
    queueSidebarRefresh(true);
    importantOsd("Trakt authorization failed");
    log("Manual Trakt auth failed: " + errStr(error));
  }
}

function handleManualSignOut() {
  trakt.signOut();
  authRequiredNoticeShown = false;
  resetCorrectionState();
  persistAuthStatus();
  queueSidebarRefresh(true);
  importantOsd("Trakt signed out");
  log("Trakt token cleared");
}

async function openCorrectionFlow(query) {
  if (!currentMedia || !currentMedia.mediaInfo) {
    return;
  }

  var episodeRoute = currentMedia.episodeRoute || mediaFusion.fromSource(currentMedia.source);
  var initialKind = correctionMedia.preferredKind(currentMedia.mediaInfo, episodeRoute);
  var position = correctionMedia.episodePosition(currentMedia.mediaInfo, episodeRoute);
  var resolvedQuery = String(query || defaultCorrectionQuery(currentMedia.mediaInfo)).trim();
  correctionState = {
    active: true,
    busy: false,
    query: resolvedQuery,
    reference: "",
    error: "",
    mediaLabel: correctionMediaLabel(),
    mediaKey: currentMediaKey(),
    kind: initialKind,
    season: initialKind === "episode" ? position.season : "",
    episode: initialKind === "episode" ? position.episode : "",
    results: []
  };
  queueSidebarRefresh(false);
  await searchCorrectionFlow(resolvedQuery);
}

async function searchCorrectionFlow(query) {
  if (!currentMedia || !currentMedia.mediaInfo) {
    resetCorrectionState();
    queueSidebarRefresh(false);
    return;
  }

  var resolvedQuery = String(query || "").trim();
  if (!resolvedQuery) {
    correctionState = Object.assign(cloneCorrectionState(correctionState), {
      active: true,
      busy: false,
      query: "",
      error: "Enter a title to search.",
      mediaLabel: correctionMediaLabel(),
      mediaKey: currentMediaKey(),
      results: []
    });
    queueSidebarRefresh(false);
    return;
  }

  var mediaKey = currentMediaKey();
  correctionState = Object.assign(cloneCorrectionState(correctionState), {
    active: true,
    busy: true,
    query: resolvedQuery,
    error: "",
    mediaLabel: correctionMediaLabel(),
    mediaKey: mediaKey,
    results: []
  });
  queueSidebarRefresh(false);

  try {
    var mediaForSearch = correctionMedia.searchMedia(currentMedia.mediaInfo,
      correctionState.kind, currentMedia.episodeRoute);
    var results = await trakt.searchCorrectionCandidates(mediaForSearch, resolvedQuery, 8);
    if (mediaKey !== currentMediaKey()) {
      return;
    }

    correctionState = Object.assign(cloneCorrectionState(correctionState), {
      active: true,
      busy: false,
      query: resolvedQuery,
      error: results.length ? "" : "No Trakt matches found.",
      mediaLabel: correctionMediaLabel(),
      mediaKey: mediaKey,
      results: results
    });
    log("Correction search returned " + results.length + " result(s) for " + correctionMediaLabel());
  } catch (error) {
    if (mediaKey !== currentMediaKey()) {
      return;
    }

    correctionState = Object.assign(cloneCorrectionState(correctionState), {
      active: true,
      busy: false,
      query: resolvedQuery,
      error: errStr(error),
      mediaLabel: correctionMediaLabel(),
      mediaKey: mediaKey,
      results: []
    });
    log("Correction search failed: " + errStr(error));
  }

  queueSidebarRefresh(false);
}

async function lookupCorrectionReference(reference) {
  if (!currentMedia || !currentMedia.mediaInfo) {
    resetCorrectionState();
    queueSidebarRefresh(false);
    return;
  }

  var resolvedReference = String(reference || "").trim();
  if (!resolvedReference) {
    correctionState = Object.assign(cloneCorrectionState(correctionState), {
      active: true,
      busy: false,
      reference: "",
      error: "Enter a Trakt ID or slug.",
      mediaLabel: correctionMediaLabel(),
      mediaKey: currentMediaKey()
    });
    queueSidebarRefresh(false);
    return;
  }

  var mediaKey = currentMediaKey();
  correctionState = Object.assign(cloneCorrectionState(correctionState), {
    active: true,
    busy: true,
    reference: resolvedReference,
    error: "",
    mediaLabel: correctionMediaLabel(),
    mediaKey: mediaKey
  });
  queueSidebarRefresh(false);

  try {
    var mediaForLookup = correctionMedia.searchMedia(currentMedia.mediaInfo,
      correctionState.kind, currentMedia.episodeRoute);
    var result = await trakt.lookupCorrectionReference(mediaForLookup, resolvedReference);
    if (mediaKey !== currentMediaKey()) {
      return;
    }

    correctionState = Object.assign(cloneCorrectionState(correctionState), {
      active: true,
      busy: false,
      reference: resolvedReference,
      error: result ? "" : "No Trakt match found for that ID or slug.",
      mediaLabel: correctionMediaLabel(),
      mediaKey: mediaKey,
      results: result ? [result] : []
    });

    if (result) {
      log(
        "Correction reference lookup resolved " +
          resolvedReference +
          " -> " +
          correctionResultLabel(result, currentMedia.mediaInfo)
      );
    }
  } catch (error) {
    if (mediaKey !== currentMediaKey()) {
      return;
    }

    correctionState = Object.assign(cloneCorrectionState(correctionState), {
      active: true,
      busy: false,
      reference: resolvedReference,
      error: errStr(error),
      mediaLabel: correctionMediaLabel(),
      mediaKey: mediaKey
    });
    log("Correction reference lookup failed: " + errStr(error));
  }

  queueSidebarRefresh(false);
}

async function applyCorrectionChoice(traktId, season, episode) {
  if (!currentMedia || !currentMedia.mediaInfo) {
    return;
  }

  var originalMediaInfo = cloneMediaInfo(currentMedia.mediaInfo);
  var mediaKey = currentMediaKey();
  var chosenId = Number(traktId || 0);
  if (!chosenId) {
    return;
  }

  correctionState = Object.assign(cloneCorrectionState(correctionState), {
    active: true,
    busy: true,
    error: ""
  });
  queueSidebarRefresh(false);

  try {
    var chosenResult = (correctionState.results || []).find(function(result) {
      return Number(result.trakt || 0) === chosenId;
    }) || null;
    // Manual mode is authoritative even if the parser mistakenly guessed Movie.
    // Require the selected candidate's kind to agree with the current search mode.
    var mediaInfo = correctionMedia.selectMedia(originalMediaInfo,
      correctionState.kind, chosenResult, season, episode);
    await trakt.applyMatchOverride(mediaInfo, chosenId);
    if (mediaKey !== currentMediaKey()) {
      return;
    }

    if (currentMedia) {
      currentMedia.mediaInfo = mediaInfo;
      // If a user manually corrects during the network lookup, ignore its stale result.
      currentMedia.freshState = "";
      currentMedia.manuallyCorrected = true;
      currentMedia.traktTargetLabel = correctionResultLabel(chosenResult, mediaInfo);
      beginResumeCheck(currentMedia);
      // An explicit show selection can safely apply to the same torrent/season
      // but never to a different torrent or season without new verification.
      if (currentMedia.episodeRoute && mediaInfo.type === "episode" &&
          chosenResult && chosenResult.title &&
          mediaInfo.season === currentMedia.episodeRoute.season) {
        mediaFusionShowCache.remember(currentMedia.episodeRoute, chosenId, chosenResult.title);
      }
    }
    log("Applied manual Trakt match " + chosenId + " for " + mediaLabel(mediaInfo));
    resetCorrectionState();
    playbackState.lastScrobbleKey = "";
    setScrobbleStatus({
      status: "ready",
      verb: "",
      mediaLabel: currentMedia ? scrobbleTargetLabel(currentMedia) : correctionResultLabel(chosenResult, mediaInfo),
      detail: "Watching for playback changes.",
      reason: ""
    });
    queueSidebarRefresh(true);
    resyncCurrentPlayback("Re-syncing current playback after manual correction");
    importantOsd("Trakt match corrected");
  } catch (error) {
    if (mediaKey !== currentMediaKey()) {
      return;
    }

    correctionState = Object.assign(cloneCorrectionState(correctionState), {
      active: true,
      busy: false,
      error: errStr(error)
    });
    queueSidebarRefresh(false);
    log("Applying manual Trakt match failed: " + errStr(error));
  }
}

function checkAuthActionRequest() {
  var nonce = String(preferences.get("auth_action_nonce") || "");
  if (!nonce || nonce === lastHandledAuthActionNonce) {
    return;
  }

  lastHandledAuthActionNonce = nonce;
  var action = String(preferences.get("auth_action_kind") || "");
  persistPreferences({
    auth_action_kind: "",
    auth_action_nonce: ""
  });

  if (!action) {
    return;
  }

  authActionChain = authActionChain.then(async function() {
    if (action === "show_sidebar") {
      log("Preferences requested sidebar show");
      showSidebarTab();
      queueSidebarRefresh(true);
      return;
    }

    if (action === "connect") {
      var force = trakt.getAuthStatus().state === "connected";
      await runManualAuth(force);
      return;
    }

    if (action === "signout") {
      handleManualSignOut();
    }
  }).catch(function(error) {
    log("Auth action failed: " + errStr(error));
    persistAuthStatus();
  });
}

function parsedLabel(parsed) {
  if (!parsed) return "unparsed";
  if (parsed.kind === "episode") {
    return parsed.showTitle + " S" + parsed.season + "E" + parsed.episode;
  }
  return parsed.title || parsed.kind;
}

function isScrobblingEnabled() {
  return prefBool("scrobble_enabled", true);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function mediaInfoFromParsed(parsed) {
  if (!parsed) return null;
  if (parsed.kind === "movie") {
    return {
      type: "movie",
      title: parsed.title,
      year: parsed.year || null
    };
  }

  if (parsed.kind === "episode") {
    return {
      type: "episode",
      title: parsed.showTitle,
      showTitle: parsed.showTitle,
      year: parsed.year || null,
      season: parsed.season,
      episode: parsed.episode,
      episodeTitle: parsed.episodeTitle || "",
      unresolvedShow: !!parsed.unresolvedShow,
      manualTraktId: Number(parsed.manualTraktId || 0),
      identitySource: parsed.parserSource === "aiostreams-title-fragment"
        ? "aiostreams-title-fragment" : ""
    };
  }

  return null;
}

function mediaLabel(mediaInfo) {
  if (!mediaInfo) return "unknown media";
  if (mediaInfo.type === "episode") {
    var suffix = mediaInfo.episodeTitle ? (" - " + mediaInfo.episodeTitle) : "";
    return mediaInfo.showTitle + " S" + pad2(mediaInfo.season) + "E" + pad2(mediaInfo.episode) + suffix;
  }
  return mediaInfo.title + (mediaInfo.year ? (" (" + mediaInfo.year + ")") : "");
}

function correctionResultLabel(result, mediaInfo) {
  if (!result) return "";
  if (result.kind === "episode") {
    var suffix = mediaInfo && mediaInfo.episodeTitle ? (" - " + mediaInfo.episodeTitle) : "";
    return String(result.title || "") +
      " S" + pad2(mediaInfo && mediaInfo.season) +
      "E" + pad2(mediaInfo && mediaInfo.episode) +
      suffix;
  }

  return String(result.title || "") + (result.year ? (" (" + result.year + ")") : "");
}

function labelFromTraktScrobbleBody(body, mediaInfo) {
  var payload = body || {};

  if (payload.movie && payload.movie.title) {
    return String(payload.movie.title) + (payload.movie.year ? (" (" + payload.movie.year + ")") : "");
  }

  if (payload.show && payload.show.title) {
    var episodeTitle = payload.episode && payload.episode.title
      ? String(payload.episode.title)
      : String((mediaInfo && mediaInfo.episodeTitle) || "");
    return String(payload.show.title) +
      " S" + pad2(payload.episode && payload.episode.season ? payload.episode.season : (mediaInfo && mediaInfo.season)) +
      "E" + pad2(payload.episode && payload.episode.number ? payload.episode.number : (mediaInfo && mediaInfo.episode)) +
      (episodeTitle ? (" - " + episodeTitle) : "");
  }

  return "";
}

function scrobbleTargetLabel(snapshot) {
  if (!snapshot) return "";
  return String(snapshot.traktTargetLabel || "") || mediaLabel(snapshot.mediaInfo);
}

function correctionMediaLabel() {
  if (!currentMedia || !currentMedia.mediaInfo) return "";
  return scrobbleTargetLabel(currentMedia);
}

function cloneMediaInfo(mediaInfo) {
  if (!mediaInfo) return null;
  return {
    type: mediaInfo.type,
    title: mediaInfo.title,
    showTitle: mediaInfo.showTitle,
    year: mediaInfo.year,
    season: mediaInfo.season,
    episode: mediaInfo.episode,
    episodeTitle: mediaInfo.episodeTitle,
    unresolvedShow: !!mediaInfo.unresolvedShow,
    manualTraktId: Number(mediaInfo.manualTraktId || 0),
    identitySource: mediaInfo.identitySource === "aiostreams-title-fragment" ? "aiostreams-title-fragment" : "",
    imdb: mediaInfo.imdb || "",
    tmdb: Number(mediaInfo.tmdb||0)
  };
}

function currentMediaKey() {
  return currentMedia && currentMedia.mediaInfo
    ? monitor.mediaKey(currentMedia.mediaInfo)
    : "";
}

function defaultCorrectionQuery(mediaInfo) {
  if (!mediaInfo) return "";
  if (mediaInfo.type === "episode") {
    return mediaInfo.unresolvedShow ? "" :
      String(mediaInfo.showTitle || mediaInfo.title || "").trim();
  }
  return String(mediaInfo.title || "").trim();
}

function resetCorrectionState() {
  correctionState = createCorrectionState();
}

function cloneSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    state: snapshot.state,
    duration: snapshot.duration,
    position: snapshot.position,
    progress: snapshot.progress,
    updatedAt: snapshot.updatedAt,
    mediaInfo: cloneMediaInfo(snapshot.mediaInfo),
    traktTargetLabel: String(snapshot.traktTargetLabel || "")
  };
}

function createResumableTimer(timeoutMs, callback) {
  var remainingMs = timeoutMs;
  var startedAt = 0;
  var timerId = null;

  function clear() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function schedule() {
    clear();
    startedAt = Date.now();
    timerId = setTimeout(function() {
      timerId = null;
      callback();
    }, remainingMs);
  }

  return {
    start: function() {
      remainingMs = timeoutMs;
      schedule();
    },
    pause: function() {
      if (timerId === null) return;
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
      clear();
    },
    resume: function() {
      if (timerId !== null) return;
      schedule();
    },
    cancel: function() {
      clear();
    }
  };
}

function playbackConfig() {
  return {
    skipInterval: prefNumber("skip_interval", 5),
    previewThreshold: prefNumber("preview_threshold", 80),
    previewDuration: prefNumber("preview_duration", 60),
    fastPauseThreshold: prefNumber("fast_pause_threshold", 1),
    fastPauseDuration: prefNumber("fast_pause_duration", 5)
  };
}

// Hydrate only from explicit, independently verified external IDs.
// Never match by the localized episode title alone. Reject stale async replies
// when playback changes to another stream during the Trakt network request.
async function verifyFreshPlayback(target,external) {
  try {
    var resolved=await trakt.resolveFreshIdentity(external);
    if (!currentMedia || currentMedia!==target || target.freshState!=="resolving")return;
    if (!resolved) {
      target.freshState="rejected";
      setScrobbleStatus({status:"unmatched",mediaLabel:mediaLabel(target.mediaInfo),
        detail:"External ID could not be independently verified on Trakt. Use Correct Match.",
        reason:"missing-trakt-match"});
      queueSidebarRefresh(false);
      return;
    }
    var info=target.mediaInfo,parsed=target.parsed;
    if (resolved.kind==="episode") {
      info.type="episode";
      info.title=resolved.title;info.showTitle=resolved.title;
      info.season=resolved.season;info.episode=resolved.episode;
      info.unresolvedShow=false;
      parsed.kind="episode";parsed.showTitle=resolved.title;
      parsed.season=resolved.season;parsed.episode=resolved.episode;
      parsed.unresolvedShow=false;
      if(!info.episodeTitle)info.episodeTitle=resolved.episodeTitle||"";
    } else {
      info.type="movie";info.title=resolved.title;info.year=resolved.year;
      info.unresolvedShow=false;
      parsed.kind="movie";parsed.title=resolved.title;
      parsed.year=resolved.year;
    }
    info.manualTraktId=resolved.trakt;
    if (resolved.imdb && /^tt\\d{6,10}$/i.test(resolved.imdb))info.imdb=resolved.imdb;
    info.tmdb=resolved.tmdb||0;
    target.freshIdKind=resolved.source;
    target.freshState="verified";
    parsed.parserSource=resolved.source;
    target.traktTargetLabel=resolved.kind==="episode" ?
      resolved.title+" S"+pad2(resolved.season)+"E"+pad2(resolved.episode)+
      (resolved.episodeTitle?" - "+resolved.episodeTitle:"") : resolved.title;
    setScrobbleStatus({status:"ready",mediaLabel:mediaLabel(info),
      detail:"External ID independently verified. Live scrobbling enabled.",
      reason:""});
    resetPlaybackTracking();
    beginResumeCheck(target);
    queueSidebarRefresh(false);
    // beginResumeCheck will scrobble only after verifying Trakt resume.
  } catch (error) {
    if (!currentMedia || currentMedia!==target)return;
    target.freshState="rejected";
    log("Fresh media verification failed: "+errStr(error));
    setScrobbleStatus({status:"unmatched",mediaLabel:mediaLabel(target.mediaInfo),
      detail:"Trakt lookup unavailable; no unverified scrobble sent. Retry by reopening playback.",
      reason:"missing-trakt-match"});
    queueSidebarRefresh(false);
  }
}

function identifyCurrentMedia() {
  var source = getCurrentSource();
  var picked = playbackIdentity.identify(source, parser, streamSource);
  var parsed = picked.parsed;
  var episodeRoute = picked.episodeRoute || null;
  var external=freshIdentity.inspect(source,episodeRoute);
  if (parsed && parsed.unresolvedShow && episodeRoute && !(external && external.conflict)) {
    var packMatch = mediaFusionShowCache.find(episodeRoute);
    if (packMatch) {
      parsed.showTitle = packMatch.title;
      parsed.unresolvedShow = false;
      parsed.manualTraktId = packMatch.trakt;
      parsed.parserSource = "mediafusion-confirmed-pack";
    }
  }
  // Some providers expose a trusted series ID without episode numbers.
  // Only borrow missing S/E from parsed playback metadata; independent Trakt
  // resolution, title equivalence and exact episode verification remain required.
  external=freshIdentity.completeEpisodePosition(external,parsed);
  // On a fresh external ID, the parser's localized metadata is not proof
  // of a series. Hold playback until Trakt resolves and verifies the episode.
  var freshPending=false;
  var freshConflict=!!(external&&external.conflict);
  if (external && !external.conflict && external.kind==="episode" &&
      Number.isInteger(external.season)&&Number.isInteger(external.episode)) {
    if (parsed && parsed.kind==="episode" &&
        (parsed.season!==external.season||parsed.episode!==external.episode)) {
      freshConflict=true;
    } else {
      var episodeTitle=parsed && parsed.kind==="episode" ? parsed.episodeTitle :
        String(source.metadataTitle||source.mediaTitle||source.title||"");
      parsed={kind:"episode",showTitle:"Unknown Series",
        season:external.season,episode:external.episode,
        episodeTitle:episodeTitle,unresolvedShow:true,
        parserSource:"explicit-playback-id-pending"};
      freshPending=true;
    }
  } else if(external && !external.conflict && external.kind==="movie" &&
      (!parsed || parsed.kind==="movie")) {
    if(!parsed)parsed={kind:"movie",title:"Unknown Movie",year:null};
    freshPending=true;
    parsed.parserSource="explicit-playback-id-pending";
  } else if(external && !external.conflict) {
    // A show ID without S/E, or a conflict with parsed media type,
    // must not accidentally fall back to unrelated movie title search.
    freshConflict=true;
  }
  if(freshConflict && parsed) {
    if(parsed.kind==="episode")parsed.unresolvedShow=true;
    parsed.parserSource="conflicting-external-id";
  }
  logGuessitFailureOnce();
  var mediaInfo = mediaInfoFromParsed(parsed);
  if (mediaInfo && picked.imdb) {
    mediaInfo.imdb = picked.imdb;
  }
  log("Playback identification: " + (parsed ? parsedLabel(parsed) : "no confident match") +
      " via " + picked.source + (picked.imdb ? " imdb=" + picked.imdb : ""));
  currentMedia = parsed ? {
    source: source,
    parsed: parsed,
    episodeRoute: episodeRoute,
    mediaInfo: mediaInfo,
    freshState:freshConflict?"conflict":freshPending?"resolving":"",
    freshIdKind:"",
    manuallyCorrected: false,
    traktTargetLabel: "",
    identifiedAt: new Date().toISOString()
  } : null;

  if (!parsed) {
    lastScrobbleStatus = createScrobbleStatus();
    setScrobbleStatus({
      status: "idle",
      verb: "",
      mediaLabel: "",
      detail: "The current file could not be classified."
    });
    log("Could not classify current media");
    debugOsd("Could not classify current media");
    return;
  }

  setScrobbleStatus({
    status: isScrobblingEnabled() ? "ready" : "disabled",
    verb: "",
    mediaLabel: currentMedia && currentMedia.mediaInfo ? mediaLabel(currentMedia.mediaInfo) : parsedLabel(parsed),
    detail: mediaInfo && mediaInfo.unresolvedShow
      ? "MediaFusion S/E verified; select the show using Correct Match."
      : isScrobblingEnabled() ? "Watching for playback changes." : "Scrobbling is turned off.",
    reason: mediaInfo && mediaInfo.unresolvedShow ? "missing-trakt-match" :
      isScrobblingEnabled() ? "" : "disabled"
  });
  if (currentMedia && freshPending && !freshConflict) {
    setScrobbleStatus({status:"ready",mediaLabel:mediaLabel(mediaInfo),
      detail:"Verifying embedded IMDb/TMDB ID before live scrobbling.",
      reason:"missing-trakt-match"});
    verifyFreshPlayback(currentMedia,external);
  } else if (currentMedia && freshConflict) {
    setScrobbleStatus({status:"unmatched",mediaLabel:mediaLabel(mediaInfo),
      detail:"Conflicting external IDs or episode positions; use Correct Match.",
      reason:"missing-trakt-match"});
  }
  if (currentMedia && !freshPending && !freshConflict) beginResumeCheck(currentMedia);
  log("Parsed " + parsedLabel(parsed) + " via " + (parsed.parserSource || "unknown"));
  debugOsd("Parsed " + parsedLabel(parsed));
}

function clearTimer(name) {
  var timer = playbackState[name];
  if (timer && typeof timer.cancel === "function") {
    timer.cancel();
  }
  playbackState[name] = null;
}

function exitPreview() {
  if (!playbackState.preview) return;
  playbackState.preview = false;
  playbackState.scrobbleBuffer = null;
  clearTimer("previewTimer");
  log("Preview mode ended");
}

function exitFastPause() {
  if (!playbackState.fastPause) return;
  playbackState.fastPause = false;
  playbackState.scrobbleBuffer = null;
  clearTimer("fastPauseTimer");
  log("Fast-pause mode ended");
}

function resetPlaybackTracking() {
  exitPreview();
  exitFastPause();
  playbackState.prevSnapshot = null;
  playbackState.scrobbleBuffer = null;
  playbackState.lastScrobbleKey = "";
  playbackState.preview = false;
  playbackState.fastPause = false;
}

function buildLiveSnapshot() {
  if (!currentMedia || !currentMedia.mediaInfo) {
    return null;
  }

  var duration = Number(core.status.duration || 0);
  if (!isFinite(duration) || duration <= 0) {
    return null;
  }

  var position = Number(core.status.position || 0);
  if (!isFinite(position)) position = 0;
  if (position < 0) position = 0;
  if (position > duration) position = duration;

  var state = core.status.idle
    ? monitor.State.Stopped
    : (core.status.paused ? monitor.State.Paused : monitor.State.Playing);

  return {
    state: state,
    duration: duration,
    position: position,
    progress: monitor.computeProgress(position, duration),
    updatedAt: Date.now() / 1000,
    mediaInfo: cloneMediaInfo(currentMedia.mediaInfo),
    traktTargetLabel: String(currentMedia.traktTargetLabel || "")
  };
}

function buildStoppedSnapshot(prevSnapshot) {
  if (!prevSnapshot) return null;
  return {
    state: monitor.State.Stopped,
    duration: prevSnapshot.duration,
    position: prevSnapshot.position,
    progress: prevSnapshot.progress,
    updatedAt: Date.now() / 1000,
    mediaInfo: cloneMediaInfo(prevSnapshot.mediaInfo),
    traktTargetLabel: String(prevSnapshot.traktTargetLabel || "")
  };
}

function resyncCurrentPlayback(logMessage) {
  var snapshot = buildLiveSnapshot();
  if (!snapshot || !snapshot.mediaInfo || snapshot.state === monitor.State.Stopped) {
    return;
  }

  playbackState.lastScrobbleKey = "";
  if (logMessage) {
    log(logMessage);
  }
  queueScrobble(monitor.stateVerb(snapshot.state), snapshot);
}

function resyncCurrentPlaybackAfterAuth() {
  resyncCurrentPlayback("Re-syncing current playback after Trakt auth");
}

function setScrobblingEnabled(enabled) {
  var nextValue = !!enabled;
  var prevValue = isScrobblingEnabled();
  if (nextValue === prevValue) {
    queueSidebarRefresh(false);
    return;
  }

  persistPreferences({
    scrobble_enabled: nextValue
  });

  resetPlaybackTracking();
  playbackState.lastScrobbleKey = "";

  if (nextValue) {
    log("Trakt scrobbling enabled");
    importantOsd("Trakt scrobbling enabled");
    if (currentMedia && currentMedia.mediaInfo) {
      setScrobbleStatus({
        status: "ready",
        verb: "",
        mediaLabel: mediaLabel(currentMedia.mediaInfo),
        detail: "Watching for playback changes.",
        reason: ""
      });
    } else {
      setScrobbleStatus(createScrobbleStatus());
    }
    resyncCurrentPlayback("Re-syncing current playback after enabling scrobbling");
    return;
  }

  log("Trakt scrobbling disabled");
  importantOsd("Trakt scrobbling paused");
  setScrobbleStatus({
    status: "disabled",
    verb: "",
    mediaLabel: currentMedia && currentMedia.mediaInfo ? mediaLabel(currentMedia.mediaInfo) : "",
    detail: "Scrobbling is turned off.",
    reason: "disabled",
    progress: null
  });
}

function queueScrobble(verb, snapshot, options) {
  if (!isScrobblingEnabled()) {
    setScrobbleStatus({
      status: "disabled",
      verb: "",
      mediaLabel: snapshot && snapshot.mediaInfo ? mediaLabel(snapshot.mediaInfo) : "",
      detail: "Scrobbling is turned off.",
      reason: "disabled",
      progress: null
    });
    return;
  }

  var payload = cloneSnapshot(snapshot);
  if (!payload || !payload.mediaInfo) return;
  // Strict read-before-write: even "start" at 00:00 can regress a saved
  // Trakt resume point. Never send while the preflight is pending/unavailable.
  if (!(options && options.journalId)) {
    var currentGate=currentMedia&&currentMedia.resumeGate;
    var check=currentGate?currentGate.decision(Number(payload.progress)):null;
    if (!check || check.blocked) {
      var reason=check?check.reason:"resume-check-pending";
      var pendingIdentity=!currentGate
        ? resumeProtection.pendingIdentityStatus(
            currentMedia&&currentMedia.mediaInfo,currentMedia&&currentMedia.freshState)
        : null;
      var requiresMatch=!!(pendingIdentity&&pendingIdentity.status==="needs-match");
      setScrobbleStatus({status:requiresMatch?"unmatched":"deferred",verb:verb,
        mediaLabel:scrobbleTargetLabel(payload),
        detail:reason==="remote-ahead"
          ? "Resume Protection: seek to saved Trakt point before syncing."
          : pendingIdentity ? pendingIdentity.message
          : "Resume Protection: waiting for verified Trakt resume.",
        reason:requiresMatch?"missing-trakt-match":"resume-guard",progress:payload.progress});
      return;
    }
  }
  if (!(options && options.journalId) && currentMedia &&
      ["resolving","rejected","conflict"].includes(currentMedia.freshState)) {
    setScrobbleStatus({status:"unmatched",verb:verb,
      mediaLabel:scrobbleTargetLabel(payload),
      detail:"External ID must be verified before scrobbling.",
      reason:"missing-trakt-match",progress:payload.progress});
    return;
  }
  if (payload.mediaInfo.unresolvedShow ||
      (payload.mediaInfo.type==="episode" &&
       /^unknown series$/i.test(String(payload.mediaInfo.showTitle||"")))) {
    setScrobbleStatus({status:"unmatched",verb:verb,mediaLabel:scrobbleTargetLabel(payload),
      detail:"Select and verify the series using Correct Match before scrobbling.",
      reason:"missing-trakt-match",progress:payload.progress});
    return;
  }
  var effectiveVerb = (trakt && typeof trakt.normalizeScrobbleVerb === "function")
    ? trakt.normalizeScrobbleVerb(verb, payload.progress)
    : verb;

  var scrobbleKey = [
    effectiveVerb,
    monitor.mediaKey(payload.mediaInfo),
    String(Math.round(payload.progress * 100) / 100)
  ].join("|");

  if (playbackState.lastScrobbleKey === scrobbleKey && !(options && options.journalId)) {
    return;
  }

  playbackState.lastScrobbleKey = scrobbleKey;
  // A synchronous write-ahead record survives app termination before curl can finish.
  // An acknowledged Trakt stop removes it. Do not include stream URLs or OAuth data.
  var journalId = options && options.journalId ? String(options.journalId) : "";
  if (effectiveVerb === "stop" && !journalId) {
    var savedFinalization = stopJournal.record(payload, trustedReplayProof(payload.mediaInfo));
    journalId = savedFinalization ? savedFinalization.id : "";
    if (savedFinalization) log("Saved Trakt stop checkpoint (progress=" + payload.progress.toFixed(2) + "%)");
    else log("No verified identity for durable stop; attempting direct Trakt validation without unsafe retry");
  }
  setScrobbleStatus({
    status: "queued",
    verb: effectiveVerb,
    mediaLabel: scrobbleTargetLabel(payload),
    detail: "Queued for Trakt at " + payload.progress.toFixed(2) + "%.",
    reason: "",
    progress: payload.progress
  });
  if (effectiveVerb !== verb) {
    log(
      "Scrobble " + verb +
      " normalized to " + effectiveVerb +
      " for " + scrobbleTargetLabel(payload) +
      " at " + payload.progress.toFixed(2) + "%"
    );
  }
  log("Scrobble " + effectiveVerb + " queued for " + scrobbleTargetLabel(payload) + " at " + payload.progress.toFixed(2) + "%");
  playbackState.scrobbleChain = playbackState.scrobbleChain.then(async function() {
    if (journalId) activeStopSyncId = journalId;
    setScrobbleStatus({
      status: "sending",
      verb: effectiveVerb,
      mediaLabel: scrobbleTargetLabel(payload),
      detail: "Sending " + effectiveVerb + " to Trakt.",
      reason: "",
      progress: payload.progress
    });

    try {
      var result = await trakt.scrobble(effectiveVerb, payload.mediaInfo, payload.progress);
      if (result && result.ok) {
        if (journalId) {
          var completed = stopJournal.find(journalId);
          stopJournal.acknowledge(journalId);
          if (completed) syncHistory.record(completed, "ok");
        }
        var confirmedId=Number(result.resolvedTraktId||0);
        if (Number.isInteger(confirmedId)&&confirmedId>0) {
          confirmedPlayback={key:monitor.mediaKey(payload.mediaInfo),
            proof:{kind:"trakt-confirmed",traktId:confirmedId}};
        }
        var traktAction = successfulScrobbleAction(effectiveVerb, result);
        var traktProgress = successfulScrobbleProgress(payload.progress, result);
        var matchedLabel = labelFromTraktScrobbleBody(result.body, payload.mediaInfo) || scrobbleTargetLabel(payload);
        if (
          currentMedia &&
          currentMedia.mediaInfo &&
          monitor.mediaKey(currentMedia.mediaInfo) === monitor.mediaKey(payload.mediaInfo)
        ) {
          currentMedia.traktTargetLabel = matchedLabel;
        }
        setScrobbleStatus({
          status: "succeeded",
          verb: effectiveVerb,
          action: traktAction,
          mediaLabel: matchedLabel,
          detail: successfulScrobbleDetail(traktAction, traktProgress),
          reason: "",
          progress: traktProgress
        });
        log(
          "Scrobble " + effectiveVerb +
          " succeeded for " + matchedLabel +
          " (action=" + traktAction + ", progress=" + traktProgress.toFixed(2) + "%)"
        );
        if (traktAction === "scrobble" && trakt && typeof trakt.clearRecentHistoryCache === "function") {
          trakt.clearRecentHistoryCache();
        }
        maybeShowScrobbleStatusOsd(effectiveVerb, traktAction, payload.mediaInfo);
        if (!firstScrobbleNoticeShown) {
          debugOsd("Scrobble flow active");
          firstScrobbleNoticeShown = true;
        }
        return;
      }

      if (result && result.skip) {
        if (journalId && result.reason === "missing-trakt-match") {
          stopJournal.markReview(journalId, "Trakt match could not be verified");
        }
        if (result.reason === "missing-client-credentials" && !missingCredentialsNoticeShown) {
          importantOsd("Configure Trakt app credentials for this build");
          missingCredentialsNoticeShown = true;
        }
        if (result.reason === "auth-required" && !authRequiredNoticeShown) {
          importantOsd("Connect Trakt from the sidebar to start scrobbling");
          authRequiredNoticeShown = true;
        }
        setScrobbleStatus({
          status: "skipped",
          verb: effectiveVerb,
          mediaLabel: scrobbleTargetLabel(payload),
          reason: result.reason,
          detail: result.reason === "auth-required"
            ? "Scrobble skipped until you connect Trakt from the sidebar."
            : ("Scrobble skipped: " + result.reason),
          progress: payload.progress
        });
        log("Scrobble skipped for " + scrobbleTargetLabel(payload) + ": " + result.reason);
        return;
      }

      if (result && result.duplicate) {
        // Trakt 409 already recorded an identical scrobble; do not replay it.
        if (journalId) {
          var duplicate = stopJournal.find(journalId);
          stopJournal.acknowledge(journalId);
          if (duplicate) syncHistory.record(duplicate, "duplicate");
        }
        setScrobbleStatus({
          status: "duplicate",
          verb: effectiveVerb,
          mediaLabel: scrobbleTargetLabel(payload),
          detail: "Trakt reported this scrobble as a duplicate.",
          reason: "",
          progress: payload.progress
        });
        log("Scrobble duplicate ignored for " + scrobbleTargetLabel(payload));
        return;
      }

      if (result && result.notFound) {
        if (journalId) stopJournal.markReview(journalId, "Trakt rejected the resolved media ID");
        setScrobbleStatus({
          status: "unmatched",
          verb: effectiveVerb,
          mediaLabel: scrobbleTargetLabel(payload),
          detail: "Trakt could not match this media identity.",
          reason: "missing-trakt-match",
          progress: payload.progress
        });
        log("Trakt rejected the scrobble because the media was not found: " + scrobbleTargetLabel(payload));
        return;
      }

      setScrobbleStatus({
        status: "unknown",
        verb: effectiveVerb,
        mediaLabel: scrobbleTargetLabel(payload),
        detail: "Trakt returned no actionable result.",
        reason: "",
        progress: payload.progress
      });
      log("Scrobble returned no actionable result for " + scrobbleTargetLabel(payload));
    } catch (error) {
      var deferred = error && (error.code === "TRAKT_COOLDOWN" || error.code === "TRAKT_OFFLINE");
      setScrobbleStatus({
        status: deferred ? "deferred" : "failed",
        verb: effectiveVerb,
        mediaLabel: scrobbleTargetLabel(payload),
        detail: deferred
          ? ("Trakt temporarily unavailable. " + (journalId ? "Final progress queued for recovery." : "Waiting for connection."))
          : errStr(error),
        reason: deferred ? error.code : "",
        progress: payload.progress
      });
      log("Scrobble failed for " + scrobbleTargetLabel(payload) + ": " + errStr(error));
      if (/Missing Trakt client credentials/.test(errStr(error)) && !missingCredentialsNoticeShown) {
        importantOsd("Configure Trakt app credentials for this build");
        missingCredentialsNoticeShown = true;
      }
    } finally {
      if (journalId && activeStopSyncId === journalId) activeStopSyncId = "";
      persistAuthStatus();
      queueSidebarRefresh(false);
    }
  }).catch(function(error) {
    setScrobbleStatus({
      status: "failed",
      verb: verb,
      mediaLabel: scrobbleTargetLabel(payload),
      detail: errStr(error),
      reason: "",
      progress: payload.progress
    });
    log("Scrobble queue failure: " + errStr(error));
  });
}

async function replaySavedFinalizations() {
  if (stopReplayActive || !isScrobblingEnabled()) return;
  // A previous stop must never be replayed while a newer playback is active.
  if (currentMedia && playbackState.prevSnapshot &&
      playbackState.prevSnapshot.state !== monitor.State.Stopped) return;
  var network = trakt.getApiStatus ? trakt.getApiStatus() : { mode: "online" };
  if (network.mode !== "online") return;
  var pending = stopJournal.pending();
  if (!pending.length) return;
  stopReplayActive = true;
  try {
    log("Replaying " + pending.length + " unacknowledged Trakt stop checkpoint(s)");
    for (var i = 0; i < pending.length; i++) {
      if (trakt.getApiStatus && trakt.getApiStatus().mode !== "online") break;
      if (currentMedia && playbackState.prevSnapshot &&
          playbackState.prevSnapshot.state !== monitor.State.Stopped) break;
      var entry = pending[i];
      // A previous offline stop must not overwrite a newer Trakt checkpoint.
      // A failed lookup leaves the existing local journal untouched.
      var remote;
      try {remote=await trakt.getResumeCheckpoint(entry.mediaInfo);}
      catch(error) {
        log("Unable to validate previous stop against Trakt resume: "+errStr(error));
        break;
      }
      if(!remote || remote.status!=="ok")break;
      var remoteCheck=resumeProtection.assess(remote.progress,entry.progress);
      if(remoteCheck.blocked) {
        stopJournal.markReview(entry.id,"Saved Trakt resume is ahead of this old stop");
        log("Old stop quarantined to Needs Review: remote resume ahead");
        continue;
      }
      var replayInfo=cloneMediaInfo(entry.mediaInfo);
      if (entry.replayProof && (entry.replayProof.kind==="manual" ||
          entry.replayProof.kind==="trakt-confirmed"))
        replayInfo.manualTraktId=Number(entry.replayProof.traktId||0);
      queueScrobble("stop", {
        state: monitor.State.Stopped,
        progress: entry.progress,
        duration: 0,
        position: 0,
        updatedAt: entry.createdAt / 1000,
        mediaInfo: replayInfo,
        traktTargetLabel: ""
      }, { journalId: entry.id });
      await playbackState.scrobbleChain;
    }
  } finally {
    stopReplayActive = false;
    queueSidebarRefresh(false);
  }
}

async function flushScrobbleQueue(reason, timeoutMs) {
  var timeout = Math.max(0, Number(timeoutMs || 0));
  var label = reason ? (" for " + reason) : "";
  if (timeout > 0) {
    log("Waiting up to " + timeout + "ms for pending scrobbles" + label);
  } else {
    log("Waiting for pending scrobbles" + label);
  }

  var chain = playbackState.scrobbleChain.catch(function(error) {
    log("Pending scrobble flush saw error: " + errStr(error));
  });

  if (!timeout) {
    await chain;
    return;
  }

  await Promise.race([
    chain,
    new Promise(function(resolve) {
      setTimeout(resolve, timeout);
    })
  ]);
}

function delayedScrobble(cleanup) {
  if (playbackState.scrobbleBuffer) {
    var buffered = cloneSnapshot(playbackState.scrobbleBuffer);
    queueScrobble(monitor.stateVerb(buffered.state), buffered);
  }
  if (typeof cleanup === "function") {
    cleanup();
  }
}

function executeAction(action, prevSnapshot, currentSnapshot) {
  if (action === "scrobble") {
    queueScrobble(monitor.stateVerb(currentSnapshot.state), currentSnapshot);
    return;
  }

  if (action === "stop_previous") {
    queueScrobble("stop", prevSnapshot);
    return;
  }

  if (action === "exit_preview") {
    exitPreview();
    return;
  }

  if (action === "enter_preview") {
    exitPreview();
    playbackState.preview = true;
    playbackState.scrobbleBuffer = cloneSnapshot(currentSnapshot);
    playbackState.previewTimer = createResumableTimer(playbackConfig().previewDuration * 1000, function() {
      delayedScrobble(exitPreview);
    });
    playbackState.previewTimer.start();
    log("Entered preview mode for " + mediaLabel(currentSnapshot.mediaInfo));
    return;
  }

  if (action === "pause_preview") {
    playbackState.scrobbleBuffer = cloneSnapshot(currentSnapshot);
    if (playbackState.previewTimer) {
      playbackState.previewTimer.pause();
    }
    return;
  }

  if (action === "resume_preview") {
    playbackState.scrobbleBuffer = cloneSnapshot(currentSnapshot);
    if (playbackState.previewTimer) {
      playbackState.previewTimer.resume();
    }
    return;
  }

  if (action === "enter_fast_pause") {
    playbackState.fastPause = true;
    playbackState.scrobbleBuffer = cloneSnapshot(currentSnapshot);
    clearTimer("fastPauseTimer");
    playbackState.fastPauseTimer = createResumableTimer(playbackConfig().fastPauseDuration * 1000, function() {
      delayedScrobble(exitFastPause);
    });
    playbackState.fastPauseTimer.start();
    log("Entered fast-pause mode");
    return;
  }

  if (action === "clear_buf") {
    clearTimer("fastPauseTimer");
    playbackState.scrobbleBuffer = null;
    return;
  }

  if (action === "delayed_play") {
    clearTimer("fastPauseTimer");
    playbackState.scrobbleBuffer = cloneSnapshot(currentSnapshot);
    playbackState.fastPauseTimer = createResumableTimer(playbackConfig().fastPauseDuration * 1000, function() {
      delayedScrobble(exitFastPause);
    });
    playbackState.fastPauseTimer.start();
    return;
  }

  if (action === "exit_fast_pause") {
    exitFastPause();
    return;
  }

  if (action === "ignore") {
    log("Ignoring transition for " + mediaLabel(currentSnapshot && currentSnapshot.mediaInfo));
    return;
  }

  log("Unhandled action: " + action);
}

function processTransition(prevSnapshot, currentSnapshot, reason) {
  var actions = monitor.decideActions(prevSnapshot, currentSnapshot, {
    preview: playbackState.preview,
    fastPause: playbackState.fastPause
  }, playbackConfig());

  if (!actions.length) {
    return;
  }

  log("Transition " + reason + ": " + actions.join(", "));
  actions.forEach(function(action) {
    executeAction(action, prevSnapshot, currentSnapshot);
  });
}

function refreshPlaybackSidebar(reason) {
  // The time-pos event can fire many times per second. Rate-limit only these
  // passive UI updates, not pause/stop/identity/auth/queue transitions.
  if (reason === "time-pos.changed") {
    var now=Date.now();
    if (now-lastPlaybackSidebarRefreshAt<PLAYBACK_SIDEBAR_MIN_INTERVAL_MS) return;
    lastPlaybackSidebarRefreshAt=now;
  } else {
    lastPlaybackSidebarRefreshAt=Date.now();
  }
  queueSidebarRefresh(false);
}

function handleStatusUpdate(reason) {
  if (!currentMedia || !currentMedia.mediaInfo) {
    refreshPlaybackSidebar(reason);
    return;
  }

  var currentSnapshot = buildLiveSnapshot();
  if (!currentSnapshot) {
    refreshPlaybackSidebar(reason);
    return;
  }

  var prevSnapshot = playbackState.prevSnapshot;
  if (prevSnapshot && monitor.shouldIgnoreEndRollover(prevSnapshot, currentSnapshot)) {
    log(
      "Ignoring end-of-file rollover reset for " +
      mediaLabel(prevSnapshot.mediaInfo) +
      " at " + currentSnapshot.progress.toFixed(2) + "%"
    );
    refreshPlaybackSidebar(reason);
    return;
  }
  processTransition(prevSnapshot, currentSnapshot, reason || "status");
  playbackState.prevSnapshot = currentSnapshot;
  refreshPlaybackSidebar(reason);
}

async function finalizeCurrentMedia(reason) {
  if (!playbackState.prevSnapshot) {
    currentMedia = null;
    lastSourceSignature = "";
    resetCorrectionState();
    resetPlaybackTracking();
    setScrobbleStatus({
      status: "idle",
      verb: "",
      mediaLabel: "",
      detail: "Waiting for playback."
    });
    return;
  }

  var prevSnapshot = playbackState.prevSnapshot;
  var stoppedSnapshot = buildStoppedSnapshot(prevSnapshot);
  processTransition(prevSnapshot, stoppedSnapshot, reason || "stop");
  playbackState.prevSnapshot = stoppedSnapshot;
  currentMedia = null;
  lastSourceSignature = "";
  resetCorrectionState();
  queueSidebarRefresh(false);
  if (reason === "end-file" || reason === "window-will-close" || reason === "mpv.shutdown") {
    await flushScrobbleQueue(reason, 3000);
    if (currentMedia || lastSourceSignature) {
      log("New media became active during end-file flush; preserving new playback state");
      return;
    }
  }
  resetPlaybackTracking();
  queueSidebarRefresh(false);
}

function scheduleBootstrapTicks() {
  [250, 1000, 2000].forEach(function(delayMs) {
    setTimeout(function() {
      handleStatusUpdate("bootstrap:" + delayMs);
    }, delayMs);
  });
}

function ensurePollTimer() {
  if (pollTimer !== null) return;
  pollTimer = setInterval(function() {
    handleStatusUpdate("poll");
  }, POLL_INTERVAL_MS);
}

function ensureUiPollTimer() {
  if (uiPollTimer !== null) return;
  uiPollTimer = setInterval(function() {
    if (trakt.getAuthStatus().busy) {
      persistAuthStatus();
    }
    checkAuthActionRequest();
    queueSidebarRefresh(false);
  }, UI_POLL_INTERVAL_MS);
}

async function handleFileLoaded() {
  var source = getCurrentSource();
  var signature = source.path || source.url || source.filename || source.title;
  if (signature && signature === lastSourceSignature && currentMedia) {
    return;
  }

  if (currentMedia && lastSourceSignature && signature && signature !== lastSourceSignature) {
    await finalizeCurrentMedia("new-file");
  } else {
    resetPlaybackTracking();
    currentMedia = null;
    resetCorrectionState();
  }

  lastSourceSignature = signature;
  missingCredentialsNoticeShown = false;
  authRequiredNoticeShown = false;
  identifyCurrentMedia();
  scheduleBootstrapTicks();
}

appendDebugLog("[IINATraktScrobbler] --------------------------------------------------");
appendDebugLog("[IINATraktScrobbler] Session start");
log("Plugin main loaded");
appendDebugLog("[IINATraktScrobbler] Parser mode default=guessit-with-heuristic-fallback");
persistAuthStatus();
registerMenuItems();
ensurePollTimer();
ensureUiPollTimer();
// Prevent a 200KB read+rewrite for every diagnostic line (on Mac field tests
// this happened repeatedly within a single second).
setInterval(function() { debugLog.flush(); }, DEBUG_LOG_FLUSH_INTERVAL_MS);
debugLog.flush();
replaySavedFinalizations();
stopReplayTimer = setInterval(function() {
  void replaySavedFinalizations();
}, 30000);

event.on("iina.window-loaded", wrapEvent("iina.window-loaded", function() {
  initializeSidebar();
  debugOsd("Plugin loaded");
}));

event.on("iina.file-loaded", wrapEvent("iina.file-loaded", function() {
  return handleFileLoaded();
}));

event.on("mpv.pause.changed", wrapEvent("mpv.pause.changed", function() {
  handleStatusUpdate("pause.changed");
}));

event.on("mpv.time-pos.changed", wrapEvent("mpv.time-pos.changed", function() {
  handleStatusUpdate("time-pos.changed");
}));

event.on("mpv.duration.changed", wrapEvent("mpv.duration.changed", function() {
  handleStatusUpdate("duration.changed");
}));

event.on("mpv.end-file", wrapEvent("mpv.end-file", function() {
  return finalizeCurrentMedia("end-file");
}));

// This fires before the IINA player window is torn down. Save stop checkpoint
// synchronously so that an interrupted network request is replayed next launch.
event.on("iina.window-will-close", wrapEvent("iina.window-will-close", function() {
  if (playbackState.prevSnapshot && playbackState.prevSnapshot.state !== monitor.State.Stopped) {
    var latest = buildLiveSnapshot();
    if (latest && latest.progress >= 1 &&
        monitor.mediaKey(latest.mediaInfo) === monitor.mediaKey(playbackState.prevSnapshot.mediaInfo) &&
        !monitor.shouldIgnoreEndRollover(playbackState.prevSnapshot, latest)) {
      playbackState.prevSnapshot = latest;
    }
  }
  // Capture the current diagnostic batch before IINA starts teardown.
  debugLog.flush();
  return Promise.resolve(finalizeCurrentMedia("window-will-close")).finally(function() {
    debugLog.flush();
  });
}));

// Additional late safety net for IINA builds that skip the window lifecycle
// event during process shutdown. The journal prevents loss across teardown.
event.on("mpv.shutdown", wrapEvent("mpv.shutdown", function() {
  debugLog.flush();
  return Promise.resolve(finalizeCurrentMedia("mpv.shutdown")).finally(function() {
    debugLog.flush();
  });
}));
