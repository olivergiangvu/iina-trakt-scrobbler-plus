-- AIO-IINA Bridge: custom URL protocol entry point.
-- Preserve the original URL intact; bridge.py validates the scheme and media.
on open location incomingURL
    try
        set thisBundle to POSIX path of (path to me)
        set bootstrap to thisBundle & "Contents/Resources/launcher.sh"
        -- Do not block AppleEvents on subtitles or IINA startup.
        -- Quoted forms prevent shell injection from custom URL text.
        do shell script (quoted form of bootstrap) & " " & (quoted form of incomingURL) & " </dev/null >/dev/null 2>&1 &"
    on error
        -- Best effort only; bridge.py writes redacted diagnostics on startup.
    end try
end open location

on run
    -- Companion is a URL handler, not a separate Trakt UI.
    return
end run
