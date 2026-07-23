'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'uhd-player-subtitle-delay:v1';
const EVENT_NAME = 'uhd:subtitle-delay-change';
const MIN_DELAY_SECONDS = -5;
const MAX_DELAY_SECONDS = 5;
const STEP_SECONDS = 0.05;
const BUTTON_STEP_SECONDS = 0.1;
const APPLY_DEBOUNCE_MS = 220;
const HOST_ID = 'subtitle-sync-control-host';

interface CueTiming {
  startTime: number;
  endTime: number;
}

function clampDelay(value: number): number {
  const bounded = Math.max(MIN_DELAY_SECONDS, Math.min(MAX_DELAY_SECONDS, value));
  return Math.round(bounded / STEP_SECONDS) * STEP_SECONDS;
}

function formatDelay(value: number): string {
  if (Math.abs(value) < 0.001) return '0.00s';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}s`;
}

function readSavedDelay(): number {
  try {
    const parsed = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(parsed) ? clampDelay(parsed) : 0;
  } catch {
    return 0;
  }
}

function dispatchDelay(value: number): void {
  window.dispatchEvent(new CustomEvent<number>(EVENT_NAME, { detail: value }));
}

export function SubtitleSyncControl() {
  const originalUploadedCueTimingRef = useRef(
    new WeakMap<TextTrackCue, CueTiming>(),
  );
  const hydratedRef = useRef(false);
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const saved = readSavedDelay();
    hydratedRef.current = true;
    setDelaySeconds(saved);
    dispatchDelay(saved);
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;

    try {
      localStorage.setItem(STORAGE_KEY, String(delaySeconds));
    } catch {
      // Subtitle synchronization must keep working without local storage.
    }

    const timer = window.setTimeout(
      () => dispatchDelay(delaySeconds),
      APPLY_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [delaySeconds]);

  useEffect(() => {
    const attachPortalHost = () => {
      const subtitleOffButton = document.querySelector<HTMLElement>(
        '[data-testid="subtitle-off"]',
      );
      const panel = subtitleOffButton?.parentElement;

      if (!panel) {
        setPortalHost((current) => {
          current?.remove();
          return null;
        });
        return;
      }

      let host = panel.querySelector<HTMLElement>(`#${HOST_ID}`);
      if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.dataset.testid = 'subtitle-sync-control';
        panel.appendChild(host);
      }
      setPortalHost(host);
    };

    attachPortalHost();
    const observer = new MutationObserver(attachPortalHost);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.getElementById(HOST_ID)?.remove();
    };
  }, []);

  useEffect(() => {
    // Built-in HLS subtitles are shifted by the playback API. Only uploaded or
    // online subtitle files are adjusted in the browser because their cues are
    // static and are not continuously replaced by hls.js.
    const applyUploadedDelay = () => {
      document
        .querySelectorAll<HTMLTrackElement>('track[data-uhd-uploaded-subtitle="true"]')
        .forEach((trackElement) => {
          const cues = trackElement.track?.cues;
          if (!cues) return;

          for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
            const cue = cues[cueIndex];
            if (!cue) continue;

            let original = originalUploadedCueTimingRef.current.get(cue);
            if (!original) {
              original = {
                startTime: cue.startTime,
                endTime: cue.endTime,
              };
              originalUploadedCueTimingRef.current.set(cue, original);
            }

            const startTime = Math.max(0, original.startTime + delaySeconds);
            const endTime = Math.max(startTime + 0.01, original.endTime + delaySeconds);
            try {
              cue.startTime = startTime;
              cue.endTime = endTime;
            } catch {
              // Some browser subtitle implementations expose immutable cues.
            }
          }
        });
    };

    applyUploadedDelay();
    const timer = window.setInterval(applyUploadedDelay, 500);
    return () => window.clearInterval(timer);
  }, [delaySeconds]);

  const valueLabel = useMemo(() => formatDelay(delaySeconds), [delaySeconds]);

  if (!portalHost) return null;

  return createPortal(
    <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-white">Subtitle synchronization</div>
          <div className="mt-0.5 text-xs text-white/50">
            Positive values show subtitles later. Negative values show them earlier.
          </div>
        </div>
        <div className="shrink-0 rounded-lg bg-black/30 px-2.5 py-1 text-sm font-semibold tabular-nums text-white/85">
          {valueLabel}
        </div>
      </div>

      <input
        type="range"
        min={MIN_DELAY_SECONDS}
        max={MAX_DELAY_SECONDS}
        step={STEP_SECONDS}
        value={delaySeconds}
        onChange={(event) => setDelaySeconds(clampDelay(Number(event.target.value)))}
        className="mt-4 w-full accent-red-600"
        aria-label="Subtitle synchronization delay"
        aria-valuetext={valueLabel}
      />

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() =>
            setDelaySeconds((value) => clampDelay(value - BUTTON_STEP_SECONDS))
          }
          className="rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
        >
          Earlier −0.10s
        </button>
        <button
          type="button"
          onClick={() => setDelaySeconds(0)}
          className="rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() =>
            setDelaySeconds((value) => clampDelay(value + BUTTON_STEP_SECONDS))
          }
          className="rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
        >
          Later +0.10s
        </button>
      </div>
    </div>,
    portalHost,
  );
}
