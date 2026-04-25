"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { format, isWithinInterval, parseISO, addDays } from "date-fns";
import type { FoodEvent, EventSource } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full grid place-items-center text-sm opacity-60">
      loading map…
    </div>
  ),
});

const ALL_SOURCES: EventSource[] = [
  "Luma",
  "Cerebral Valley",
  "X",
  "Eventbrite",
  "Meetup",
];

const SOURCE_EMOJI: Record<EventSource, string> = {
  Luma: "💫",
  "Cerebral Valley": "🧠",
  X: "𝕏",
  Eventbrite: "🎟️",
  Meetup: "👥",
};

function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}

export default function Bento({ events }: { events: FoodEvent[] }) {
  const [sources, setSources] = useState<Set<EventSource>>(
    new Set(ALL_SOURCES),
  );
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(format(addDays(new Date(), 14), "yyyy-MM-dd"));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FoodEvent | null>(null);

  const filtered = useMemo(() => {
    const fromD = parseISO(from + "T00:00:00");
    const toD = parseISO(to + "T23:59:59");
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => sources.has(e.source))
      .filter((e) =>
        isWithinInterval(parseISO(e.start), { start: fromD, end: toD }),
      )
      .filter(
        (e) =>
          !q ||
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.keywords.some((k) => k.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events, sources, from, to, query]);

  const foodTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of filtered) {
      for (const f of e.foodTypes) counts[f] = (counts[f] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [filtered]);

  const toggleSource = (s: EventSource) => {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  return (
    <div className="min-h-dvh p-4 md:p-6">
      {/* header */}
      <header className="flex items-center gap-3 mb-4 md:mb-6">
        <div className="text-3xl md:text-4xl">🍱</div>
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">
            SF Free Food Finder
          </h1>
          <p className="text-xs md:text-sm opacity-70">
            tech events with free food, on a tiny map
          </p>
        </div>
      </header>

      {/* bento grid */}
      <div className="grid grid-cols-12 gap-4 md:gap-5 auto-rows-[minmax(110px,auto)]">
        {/* MAP — big tile */}
        <div className="tile col-span-12 lg:col-span-8 row-span-4 h-[460px] lg:h-[620px]">
          <MapView events={filtered} onSelect={setSelected} />
        </div>

        {/* FILTER tile */}
        <div className="tile tile-pad col-span-12 lg:col-span-4">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
            📅 when
          </div>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="flex-1 bg-[var(--bg)] rounded-lg px-3 py-2 border border-[var(--tile-border)]"
            />
            <span className="opacity-40">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="flex-1 bg-[var(--bg)] rounded-lg px-3 py-2 border border-[var(--tile-border)]"
            />
          </div>
        </div>

        {/* SOURCES tile */}
        <div className="tile tile-pad col-span-12 lg:col-span-4">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
            🗂️ sources
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_SOURCES.map((s) => (
              <button
                key={s}
                className="chip"
                data-active={sources.has(s)}
                onClick={() => toggleSource(s)}
              >
                <span>{SOURCE_EMOJI[s]}</span>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* SEARCH + STATS tile */}
        <div className="tile tile-pad col-span-12 lg:col-span-4">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
            🔎 search
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="pizza, sushi, hackathon…"
            className="w-full bg-[var(--bg)] rounded-lg px-3 py-2 border border-[var(--tile-border)] text-sm mb-3"
          />
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-extrabold">{filtered.length}</div>
            <div className="text-xs opacity-60">events found</div>
          </div>
        </div>

        {/* FOOD TYPES tile */}
        <div className="tile tile-pad col-span-12 lg:col-span-4">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
            🍜 what's cooking
          </div>
          {foodTypeCounts.length === 0 ? (
            <div className="text-sm opacity-50">no food in this window 😿</div>
          ) : (
            <ul className="space-y-1.5">
              {foodTypeCounts.map(([label, n]) => (
                <li
                  key={label}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{label}</span>
                  <span className="font-bold text-xs bg-[var(--accent-matcha)] rounded-full px-2 py-0.5">
                    {n}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* EVENT LIST tile */}
        <div className="tile col-span-12 lg:col-span-8">
          <div className="tile-pad pb-2 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider opacity-60">
              🗓️ upcoming
            </div>
            <div className="text-xs opacity-50">
              {filtered.length} event{filtered.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="max-h-[360px] overflow-y-auto scroll-cute px-5 pb-5 space-y-2">
            {filtered.map((e) => (
              <button
                key={e.id}
                onClick={() => setSelected(e)}
                className={`w-full text-left rounded-xl border px-3 py-2.5 transition hover:border-[var(--accent-soy)] ${
                  selected?.id === e.id
                    ? "border-[var(--accent-soy)] bg-[var(--accent-tamago)]/40"
                    : "border-[var(--tile-border)] bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs opacity-60 mb-0.5">
                      {SOURCE_EMOJI[e.source]} {e.source} ·{" "}
                      {format(new Date(e.start), "EEE MMM d · h:mm a")}
                    </div>
                    <div className="font-semibold text-sm truncate">
                      {e.title}
                    </div>
                    <div className="text-xs opacity-60 truncate">{e.venue}</div>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[50%]">
                    {e.foodTypes.slice(0, 2).map((f) => (
                      <span
                        key={f}
                        className="text-[11px] bg-[var(--accent-peach)] rounded-full px-2 py-0.5 whitespace-nowrap"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="text-sm opacity-50 py-10 text-center">
                🍙 nothing in this window — widen the date range?
              </div>
            )}
          </div>
        </div>

        {/* DETAIL tile */}
        <div className="tile tile-pad col-span-12 lg:col-span-4 min-h-[220px]">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
            🥡 details
          </div>
          {selected ? (
            <div>
              <div className="text-xs opacity-60 mb-1">
                {SOURCE_EMOJI[selected.source]} {selected.source}
              </div>
              <div className="font-bold text-base mb-1">{selected.title}</div>
              <div className="text-xs opacity-70 mb-2">{selected.venue}</div>
              <div className="text-xs mb-3">
                {format(new Date(selected.start), "EEE MMM d · h:mm a")} →{" "}
                {format(new Date(selected.end), "h:mm a")}
              </div>
              <p className="text-sm leading-relaxed mb-3">
                {selected.description}
              </p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {selected.foodTypes.map((f) => (
                  <span
                    key={f}
                    className="text-xs bg-[var(--accent-sakura)] rounded-full px-2.5 py-1"
                  >
                    {f}
                  </span>
                ))}
              </div>
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block bg-[var(--accent-nori)] text-white text-sm font-semibold rounded-full px-4 py-2"
              >
                RSVP →
              </a>
            </div>
          ) : (
            <div className="text-sm opacity-50">
              click a pin or an event to see details
            </div>
          )}
        </div>
      </div>

      <footer className="text-center text-xs opacity-40 mt-8">
        made with 🍙 in sf · data from luma, cerebral valley, x, eventbrite,
        meetup
      </footer>
    </div>
  );
}
