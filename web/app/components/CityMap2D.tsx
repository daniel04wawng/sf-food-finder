"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, formatDistanceToNowStrict, parseISO, isWithinInterval, addDays } from "date-fns";
import type { FoodEvent } from "@/lib/types";

/**
 * Calibration — maps real-world lat/lng to pixel coords on the illustration.
 *
 * The illustration is an isometric drawing, not a true map projection, so this
 * uses 4 reference points (corners of the area we care about) and bilinear
 * interpolation. To re-calibrate after swapping the image:
 *   1. Open the illustration, identify 4 distinct landmarks (e.g. Ferry Building,
 *      Salesforce Tower, Twin Peaks, Chase Center).
 *   2. Look up their lat/lng (Wikipedia / Google Maps).
 *   3. Find their pixel position in the image (open image, hover in any tool).
 *   4. Update REFERENCE_POINTS below.
 *
 * Defaults below assume an image where SF downtown roughly fills the frame, with
 * north toward the top, slightly tilted as illustrations often are.
 */

const IMAGE_PATH = "/sf-map.png";
const IMAGE_W = 1600; // intrinsic width of the illustration
const IMAGE_H = 1000; // intrinsic height

interface CalibPoint {
  lat: number;
  lng: number;
  px: number; // 0..1 fraction across image width
  py: number; // 0..1 fraction down image height
}
// Sane defaults — replace once you have the actual image.
// Order: NW, NE, SW, SE corners of SF downtown bbox.
const REFERENCE_POINTS: CalibPoint[] = [
  { lat: 37.805, lng: -122.425, px: 0.12, py: 0.18 }, // NW (Russian Hill area)
  { lat: 37.805, lng: -122.385, px: 0.92, py: 0.22 }, // NE (Embarcadero N)
  { lat: 37.768, lng: -122.425, px: 0.08, py: 0.78 }, // SW (Mission)
  { lat: 37.768, lng: -122.385, px: 0.92, py: 0.86 }, // SE (Mission Bay)
];

function bilinearProject(lat: number, lng: number) {
  const [nw, ne, sw, se] = REFERENCE_POINTS;
  const u = (lng - nw.lng) / (ne.lng - nw.lng);
  const v = (lat - nw.lat) / (sw.lat - nw.lat);
  // u,v outside [0,1] still extrapolate — that's fine for events just outside bbox
  const top_x = nw.px + (ne.px - nw.px) * u;
  const top_y = nw.py + (ne.py - nw.py) * u;
  const bot_x = sw.px + (se.px - sw.px) * u;
  const bot_y = sw.py + (se.py - sw.py) * u;
  const px = top_x + (bot_x - top_x) * v;
  const py = top_y + (bot_y - top_y) * v;
  return { px, py };
}

function shortTimeTo(iso: string) {
  const d = new Date(iso);
  if (d.getTime() < Date.now()) return "past";
  return "in " + formatDistanceToNowStrict(d);
}
function todayISO() { return format(new Date(), "yyyy-MM-dd"); }

export default function CityMap2D({ events }: { events: FoodEvent[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState<boolean | null>(null);

  // Pan/zoom
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // Probe image existence so we can render a fallback when it's missing
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImageLoaded(true);
    img.onerror = () => setImageLoaded(false);
    img.src = IMAGE_PATH;
  }, []);

  const filtered = useMemo(() => {
    const fromD = parseISO(from + "T00:00:00");
    const toD = parseISO(to + "T23:59:59");
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => isWithinInterval(parseISO(e.start), { start: fromD, end: toD }))
      .filter((e) =>
        !q ||
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.keywords.some((k) => k.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events, from, to, query]);

  const selected = filtered.find((e) => e.id === selectedId) ?? null;

  // Pan handlers
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = d.vx + (e.clientX - d.x);
    const ny = d.vy + (e.clientY - d.y);
    setView((v) => ({ ...v, x: nx, y: ny }));
  };
  const onPointerUp = () => { dragRef.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.085;
    setView((v) => {
      const newScale = Math.min(3.5, Math.max(0.5, v.scale * factor));
      return { ...v, scale: newScale };
    });
  };

  // Ensure containerRef wheel preventDefault (React passive wheel issue)
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const h = (e: WheelEvent) => e.preventDefault();
    c.addEventListener("wheel", h, { passive: false });
    return () => c.removeEventListener("wheel", h);
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#f3e3c0]">
      {/* Map stage — image + pins, panned/zoomed together */}
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <div
          className="absolute left-1/2 top-1/2 origin-center"
          style={{
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            width: IMAGE_W,
            height: IMAGE_H,
            transition: dragRef.current ? "none" : "transform 0.08s ease-out",
          }}
        >
          {imageLoaded === true && (
            <img
              src={IMAGE_PATH}
              alt="SF illustrated map"
              draggable={false}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
            />
          )}
          {imageLoaded === false && (
            <div className="absolute inset-0 grid place-items-center bg-[#f3e3c0]">
              <div className="text-center max-w-md p-8 bg-white/85 rounded-2xl border border-black/5 shadow-xl">
                <div className="font-display text-2xl font-semibold mb-2">Drop your map here</div>
                <p className="text-sm text-neutral-600 mb-3">
                  Save your isometric SF illustration to{" "}
                  <code className="bg-neutral-100 rounded px-1.5 py-0.5 text-xs">web/public/sf-map.png</code>{" "}
                  and reload. Pins will appear on top.
                </p>
                <p className="text-[11px] text-neutral-500">
                  Aspect ratio doesn&apos;t matter — calibrate the 4 reference points in{" "}
                  <code className="bg-neutral-100 rounded px-1 py-0.5">CityMap2D.tsx</code>{" "}
                  if landmarks don&apos;t line up.
                </p>
              </div>
            </div>
          )}

          {/* Pins absolutely positioned on top */}
          {filtered.map((e) => {
            const { px, py } = bilinearProject(e.lat, e.lng);
            const isSel = e.id === selectedId;
            return (
              <button
                key={e.id}
                onClick={(ev) => { ev.stopPropagation(); setSelectedId(e.id); }}
                onPointerDown={(ev) => ev.stopPropagation()}
                className="absolute -translate-x-1/2 -translate-y-full focus:outline-none"
                style={{ left: `${px * 100}%`, top: `${py * 100}%` }}
                aria-label={e.title}
              >
                <div className="relative">
                  {isSel && (
                    <span className="absolute left-1/2 top-full -translate-x-1/2 w-7 h-2 rounded-full bg-yellow-400/40 blur-sm animate-pulse" />
                  )}
                  <svg width={isSel ? 38 : 28} height={isSel ? 50 : 38} viewBox="0 0 28 38" className="drop-shadow-md">
                    <path
                      d="M14 1 C 22 1 27 7 27 14 C 27 22 14 36 14 36 C 14 36 1 22 1 14 C 1 7 6 1 14 1 Z"
                      fill="#ffd84a"
                      stroke="#1a1a1a"
                      strokeWidth="2"
                    />
                    <circle cx="14" cy="14" r="4.5" fill="#1a1a1a" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Header pill */}
      <div className="pointer-events-none absolute inset-x-0 top-0 p-4 md:p-5 flex justify-center z-[10]">
        <div className="pointer-events-auto w-full max-w-4xl flex items-center gap-3 bg-white/95 backdrop-blur-md border border-black/5 rounded-full shadow-lg pl-4 pr-2 py-2">
          <div className="flex items-center gap-2.5 shrink-0 pr-1">
            <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
              <rect x="2" y="6" width="28" height="20" rx="5" fill="#1a1a1a" />
              <rect x="5" y="9" width="10" height="14" rx="2.5" fill="#f7c6d0" />
              <rect x="17" y="9" width="10" height="14" rx="2.5" fill="#c8e0b4" />
              <circle cx="10" cy="16" r="2.6" fill="#d06a45" />
              <circle cx="22" cy="13.5" r="1.6" fill="#f6a23b" />
              <circle cx="22" cy="18.5" r="1.6" fill="#f6a23b" />
            </svg>
            <span className="font-display text-[17px] font-semibold tracking-tight leading-none">
              Free&nbsp;Food&nbsp;Finder
            </span>
          </div>
          <div className="h-5 w-px bg-black/10" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="pizza, sushi, hackathon…"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-neutral-400"
          />
          <div className="hidden md:flex items-center gap-1.5 text-xs">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-neutral-100 rounded-full px-3 py-1.5" />
            <span className="text-neutral-400">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-neutral-100 rounded-full px-3 py-1.5" />
          </div>
          <div className="shrink-0 rounded-full bg-[#1a1a1a] text-white text-xs font-mono tabular-nums px-3 py-1.5">
            {filtered.length.toString().padStart(2, "0")}
          </div>
        </div>
      </div>

      {/* Reset view */}
      <div className="absolute bottom-20 right-4 z-[10]">
        <button
          onClick={() => setView({ x: 0, y: 0, scale: 1 })}
          className="bg-white/90 backdrop-blur border border-black/5 rounded-full px-3 py-1.5 text-xs font-medium shadow hover:bg-white"
        >
          Reset view
        </button>
      </div>

      {/* Detail card */}
      {selected && (
        <div className="absolute top-20 right-4 md:top-24 md:right-6 w-[320px] bg-white rounded-2xl shadow-2xl border border-black/5 overflow-hidden z-[10]">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-100">
            <span className="text-[11px] uppercase tracking-[0.12em] text-neutral-500 font-mono tabular-nums">
              {shortTimeTo(selected.start)}
            </span>
            <button onClick={() => setSelectedId(null)} className="text-neutral-400 hover:text-neutral-700 text-xs">✕</button>
          </div>
          <div className="px-4 py-3">
            <div className="font-display text-[17px] font-semibold leading-[1.15] tracking-tight mb-1 text-neutral-900">{selected.title}</div>
            <div className="text-xs text-neutral-500 mb-3">{selected.venue}</div>
            <dl className="text-xs divide-y divide-neutral-100 border-y border-neutral-100">
              <div className="grid grid-cols-[auto_1fr] py-1.5 gap-3">
                <dt className="text-neutral-500">Date</dt>
                <dd className="text-right font-mono tabular-nums">{format(new Date(selected.start), "EEE MMM d")}</dd>
              </div>
              <div className="grid grid-cols-[auto_1fr] py-1.5 gap-3">
                <dt className="text-neutral-500">Time</dt>
                <dd className="text-right font-mono tabular-nums">
                  {format(new Date(selected.start), "h:mm a")} – {format(new Date(selected.end), "h:mm a")}
                </dd>
              </div>
              <div className="grid grid-cols-[auto_1fr] py-1.5 gap-3">
                <dt className="text-neutral-500">Food</dt>
                <dd className="text-right text-neutral-800">{selected.foodTypes.join(" · ")}</dd>
              </div>
            </dl>
            <p className="text-[12px] text-neutral-600 leading-[1.55] mt-2.5 mb-2.5 line-clamp-4">{selected.description}</p>
            <a href={selected.url} target="_blank" rel="noreferrer" className="block text-center w-full bg-neutral-900 text-white text-xs font-semibold rounded-full px-4 py-2 hover:bg-neutral-700 transition no-underline">
              Open event page →
            </a>
          </div>
        </div>
      )}

      {/* Bottom sheet */}
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-[10] transition-transform duration-300 ${sheetOpen ? "translate-y-0" : "translate-y-[calc(100%-58px)]"}`}>
        <div className="pointer-events-auto mx-auto max-w-3xl bg-white/98 backdrop-blur-md border-t border-x border-black/5 rounded-t-2xl shadow-2xl">
          <button onClick={() => setSheetOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-neutral-50">
            <div className="flex items-center gap-3">
              <div className="h-1 w-10 rounded-full bg-neutral-300" />
              <span className="text-sm font-semibold">
                {filtered.length} event{filtered.length === 1 ? "" : "s"} nearby
              </span>
            </div>
            <span className="text-xs text-neutral-400">{sheetOpen ? "Hide ↓" : "Show ↑"}</span>
          </button>
          <div className="max-h-[50dvh] overflow-y-auto border-t border-neutral-100">
            {filtered.length === 0 && (
              <div className="px-8 py-12 text-center text-sm text-neutral-500">
                Nothing on the menu — widen the dates.
              </div>
            )}
            {filtered.map((e) => (
              <button
                key={e.id}
                onClick={() => { setSelectedId(e.id); setSheetOpen(false); }}
                className={`w-full text-left grid grid-cols-[1fr_auto] gap-3 px-5 py-3 border-b border-neutral-100 hover:bg-neutral-50 transition ${selectedId === e.id ? "bg-[#ffd84a]/10 border-l-2 border-l-[#ffd84a]" : ""}`}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{e.title}</div>
                  <div className="text-[11px] text-neutral-500 truncate">{e.venue}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.foodTypes.slice(0, 3).map((f) => (
                      <span key={f} className="text-[10px] text-neutral-600 bg-neutral-100 rounded px-1.5 py-0.5">{f}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right text-[11px] text-neutral-600 shrink-0">
                  <div className="font-mono tabular-nums">{format(new Date(e.start), "MMM d")}</div>
                  <div className="text-neutral-400 font-mono tabular-nums">{format(new Date(e.start), "h:mm a")}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
