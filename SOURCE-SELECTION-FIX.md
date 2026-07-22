# Source selection fix

- Keeps the exact server selected on the episode page as the primary playback source.
- Prevents the asynchronous source refresh from replacing it with the first source of the same resolution.
- Makes the Quality tab represent the active server when several servers share the same resolution.
- Clicking the already-selected quality no longer reloads or switches the stream.
- When changing resolution, the player prefers the same server family, then the smallest known file.

Regression check: `node scripts/test-source-selection-fix.cjs`
