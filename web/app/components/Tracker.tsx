"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { format, isWithinInterval, parseISO, addDays, formatDistanceToNowStrict } from "date-fns";
import type { FoodEvent, EventSource } from "@/lib/types";

const TrackerMap = dynamic(() => import("./TrackerMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-[#eaf0e7]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4),transparent_60%)]" />
    </div>
  ),
});

const ALL_SOURCES: EventSource[] = [
  "Luma",
  "Cerebral Valley",
  "X",
  "Eventbrite",
  "Meetup",
  "Partiful",
];

export const SOURCE_FILL: Record<EventSource, string> = {
  Luma: "#5b8def",
  "Cerebral Valley": "#f6a23b",
  X: "#ffffff",
  Eventbrite: "#c78bff",
  Meetup: "#4ec9b0",
  Partiful: "#ff7a59",
};

function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}

function shortTimeTo(iso: string) {
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff < 0) return "past";
  return "in " + formatDistanceToNowStrict(d);
}

export default function Tracker({ events }: { events: FoodEvent[] }) {
  const [sources, setSources] = useState<Set<EventSource>>(new Set(ALL_SOURCES));
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const fromD = parseISO(from + "T00:00:00");
    const toD = parseISO(to + "T23:59:59");
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => sources.has(e.source))
      .filter((e) => isWithinInterval(parseISO(e.start), { start: fromD, end: toD }))
      .filter((e) =>
        !q ||
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.keywords.some((k) => k.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events, sources, from, to, query]);

  const selected = filtered.find((e) => e.id === selectedId) ?? null;

  const toggleSource = (s: EventSource) => {
    setSources((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#eaf0e7]">
      {/* full-bleed map with stylized "globe" perspective */}
      <div className="absolute inset-0 globe-stage">
        <div className="globe-tilt">
          <TrackerMap events={filtered} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        {/* curvature vignette + sheen */}
        <div className="globe-vignette" aria-hidden />
        <div className="globe-sheen" aria-hidden />
      </div>

      {/* top floating header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 p-4 md:p-5 flex justify-center z-[1000]">
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
          <div className="relative flex-1 min-w-0">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pizza, sushi, hackathon…"
              className="w-full bg-transparent text-sm focus:outline-none placeholder:text-neutral-400"
            />
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-xs">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-neutral-100 rounded-full px-3 py-1.5"
            />
            <span className="text-neutral-400">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-neutral-100 rounded-full px-3 py-1.5"
            />
          </div>
          <div className="shrink-0 rounded-full bg-[#1a1a1a] text-white text-xs font-mono tabular-nums px-3 py-1.5">
            {filtered.length.toString().padStart(2, "0")}
          </div>
        </div>
      </div>



      {/* bottom sheet — list of events */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-[1000] transition-transform duration-300 ${
          sheetOpen ? "translate-y-0" : "translate-y-[calc(100%-58px)]"
        }`}
      >
        <div className="pointer-events-auto mx-auto max-w-3xl bg-white/98 backdrop-blur-md border-t border-x border-black/5 rounded-t-2xl shadow-2xl">
          <button
            onClick={() => setSheetOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-neutral-50"
          >
            <div className="flex items-center gap-3">
              <div className="h-1 w-10 rounded-full bg-neutral-300" />
              <span className="text-sm font-semibold">
                {filtered.length} event{filtered.length === 1 ? "" : "s"} nearby
              </span>
            </div>
            <span className="text-xs text-neutral-400">
              {sheetOpen ? "Hide ↓" : "Show ↑"}
            </span>
          </button>
          <div
            ref={listRef}
            className="max-h-[50dvh] overflow-y-auto border-t border-neutral-100"
          >
            {filtered.length === 0 && (
              <div className="px-8 py-12 text-center">
                <div className="mx-auto mb-3 h-10 w-10 rounded-xl bg-[#f5efe2] grid place-items-center">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <circle cx="9" cy="10" r=".8" fill="currentColor" />
                    <circle cx="15" cy="10" r=".8" fill="currentColor" />
                  </svg>
                </div>
                <div className="font-display text-[15px] font-semibold">Nothing on the menu</div>
                <div className="text-xs text-neutral-500 mt-1">
                  Widen the dates or turn a source back on.
                </div>
              </div>
            )}
            {filtered.map((e) => (
              <button
                key={e.id}
                data-id={e.id}
                onClick={() => {
                  setSelectedId(e.id);
                  setSheetOpen(false);
                }}
                className={`w-full text-left grid grid-cols-[1fr_auto_auto] gap-3 px-5 py-3 border-b border-neutral-100 hover:bg-neutral-50 transition ${
                  selectedId === e.id ? "bg-[#5b8def]/5 border-l-2 border-l-[#5b8def]" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{e.title}</div>
                  <div className="text-[11px] text-neutral-500 truncate">{e.venue}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.foodTypes.slice(0, 3).map((f) => (
                      <span key={f} className="text-[10px] text-neutral-600 bg-neutral-100 rounded px-1.5 py-0.5">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right text-[11px] text-neutral-600 shrink-0">
                  <div className="font-mono">{format(new Date(e.start), "MMM d")}</div>
                  <div className="text-neutral-400 font-mono">{format(new Date(e.start), "h:mm a")}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
