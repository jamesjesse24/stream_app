# Episode file-size display and playback regression fix

File information remains visible in these locations:

- On each episode source card before **Play**.
- At the top-left of the player.
- Above the playback timeline.
- In the **Player Settings** summary.
- In **Player Settings → Servers**.

## How file size is obtained

The app now reuses size information found while the source page is being resolved. It no longer sends separate `HEAD` or byte-range media probes from the episode page or player. This prevents file-size checks from competing with the active stream.

For HLS playback, the total and loaded values are estimates calculated from the selected bitrate, duration, and buffered media duration. The player no longer performs a React state update for every downloaded HLS fragment.

## Hiccup regression fix

Playback is keyed only by the active source URL and quality. Later changes to display-only fields—such as file size, server status, or metadata—do not destroy and recreate the HLS instance or reload the video element.

## Installation

Extract the ZIP into a new empty folder. Do not copy it over an old `.next` build. Run `start.bat` on Windows or `./start.sh` on Linux/macOS, then use **Ctrl+F5** once after the app starts.
