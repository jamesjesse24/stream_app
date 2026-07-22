# Google video playback fix

Google `video-downloads.googleusercontent.com` sources now use a three-stage playback path:

1. Same-origin byte-range proxy with no FFmpeg processing.
2. H.264 video-copy HLS remux if the browser cannot play the original container.
3. Full H.264 transcode only when direct playback and remux are incompatible.

This prevents browser playback from sending every DriveSeed Google download through CPU-intensive video encoding. The selected server and file-size metadata remain unchanged during fallback.
