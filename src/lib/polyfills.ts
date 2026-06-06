/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// iOS/Safari polyfills. Loaded FIRST (before pdfjs is imported) via main.tsx.
// Also applied inside the pdfjs worker if/when we use one — but we DISABLE the
// worker on iOS WebViews (WhatsApp/Instagram/etc.) so the parse runs on the
// main thread where these polyfills are already installed.
//
// We polyfill the smallest set pdfjs (or downstream code) actually touches:
//   - Promise.withResolvers      (ES2024)
//   - Array.prototype.at         (ES2022)
//   - Array.prototype.toSorted   (ES2023)
//   - Array.prototype.toReversed (ES2023)
//   - structuredClone            (HTML living std, missing on iOS <15.4)
//   - Object.hasOwn              (ES2022)
//
// We deliberately do NOT polyfill Array.fromAsync / Object.groupBy /
// Set.prototype.difference — pdfjs v3 doesn't reference them.

function applyPolyfills(g: any) {
  try {
    if (g.Promise && typeof g.Promise.withResolvers !== 'function') {
      g.Promise.withResolvers = function withResolvers() {
        let resolve: any, reject: any;
        const promise = new g.Promise((res: any, rej: any) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
      };
    }
  } catch (_) { /* ignore */ }

  try {
    if (g.Array && g.Array.prototype && typeof g.Array.prototype.at !== 'function') {
      Object.defineProperty(g.Array.prototype, 'at', {
        value: function (n: number) {
          const i = Math.trunc(n) || 0;
          return this[i < 0 ? this.length + i : i];
        },
        writable: true, configurable: true,
      });
    }
  } catch (_) { /* ignore */ }

  try {
    if (g.Array && g.Array.prototype && typeof g.Array.prototype.toSorted !== 'function') {
      Object.defineProperty(g.Array.prototype, 'toSorted', {
        value: function (cmp?: any) { return this.slice().sort(cmp); },
        writable: true, configurable: true,
      });
    }
  } catch (_) { /* ignore */ }

  try {
    if (g.Array && g.Array.prototype && typeof g.Array.prototype.toReversed !== 'function') {
      Object.defineProperty(g.Array.prototype, 'toReversed', {
        value: function () { return this.slice().reverse(); },
        writable: true, configurable: true,
      });
    }
  } catch (_) { /* ignore */ }

  try {
    if (typeof g.structuredClone !== 'function') {
      g.structuredClone = function structuredClone(x: any) {
        if (x === null || typeof x !== 'object') return x;
        try { return JSON.parse(JSON.stringify(x)); }
        catch (_) { return x; }
      };
    }
  } catch (_) { /* ignore */ }

  try {
    if (g.Object && typeof g.Object.hasOwn !== 'function') {
      g.Object.hasOwn = function hasOwn(obj: any, key: any) {
        return Object.prototype.hasOwnProperty.call(obj, key);
      };
    }
  } catch (_) { /* ignore */ }
}

applyPolyfills(globalThis);

// Serialized form so we can stitch the same patch into the worker source.
// Keep in sync with applyPolyfills above.
export const WORKER_POLYFILL_SOURCE = `(${applyPolyfills.toString()})(globalThis);`;

/** Detect an iOS in-app WebView (WhatsApp, Instagram, FB Messenger, Gmail, etc.)
 * — they all run on WKWebView but block blob: workers, refuse cross-origin
 * scripts in some cases, or simply ship older WebKit than mobile Safari. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && typeof (navigator as any).maxTouchPoints === 'number' && (navigator as any).maxTouchPoints > 1);
}

export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // WhatsApp, Instagram, FBAN/FBAV (Facebook), FB_IAB, Line, Snapchat, Twitter, TikTok, Gmail (GSA), Outlook
  if (/WhatsApp|Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\//i.test(ua)) return true;
  if (/Snapchat|Twitter|TikTok|GSA\/|OutlookMobile/i.test(ua)) return true;
  // On iOS, a real Safari UA contains "Safari/". WKWebView used by in-app browsers usually does NOT.
  if (isIOS() && !/Safari\//.test(ua)) return true;
  return false;
}
