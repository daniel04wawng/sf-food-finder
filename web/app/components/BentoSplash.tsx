"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

interface City {
  key: string;
  label: string;
  lat: number;
  lng: number;
  live: boolean;
}
const CITIES: City[] = [
  { key: "sf", label: "San Francisco", lat: 37.7749, lng: -122.4194, live: true },
  { key: "nyc", label: "New York", lat: 40.7128, lng: -74.006, live: false },
  { key: "tokyo", label: "Tokyo", lat: 35.6762, lng: 139.6503, live: false },
];

function haversineKm(a: City, lat: number, lng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat - a.lat);
  const dLng = toRad(lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

type GeoState =
  | { kind: "loading" }
  | { kind: "ok"; city: City; precise: boolean }
  | { kind: "denied"; city: City };

// ----- Stickers (inline SVG) ---------------------------------------------

const BearSticker = () => (
  <svg viewBox="0 0 60 60" className="w-full h-full">
    {/* ears */}
    <circle cx="16" cy="16" r="7" fill="#b07a4a" />
    <circle cx="44" cy="16" r="7" fill="#b07a4a" />
    <circle cx="16" cy="16" r="3.5" fill="#d9a66e" />
    <circle cx="44" cy="16" r="3.5" fill="#d9a66e" />
    {/* head */}
    <ellipse cx="30" cy="32" rx="18" ry="16" fill="#b07a4a" />
    {/* muzzle */}
    <ellipse cx="30" cy="37" rx="9" ry="7" fill="#efd5b3" />
    {/* eyes */}
    <ellipse cx="22" cy="30" rx="1.7" ry="2.2" fill="#2b1a10" />
    <ellipse cx="38" cy="30" rx="1.7" ry="2.2" fill="#2b1a10" />
    {/* cheeks */}
    <circle cx="19" cy="35" r="2" fill="#f2a8a0" opacity="0.7" />
    <circle cx="41" cy="35" r="2" fill="#f2a8a0" opacity="0.7" />
    {/* nose + smile */}
    <ellipse cx="30" cy="34.5" rx="1.3" ry="1" fill="#2b1a10" />
    <path d="M26 38 Q30 41 34 38" stroke="#2b1a10" strokeWidth="1.1" fill="none" strokeLinecap="round" />
  </svg>
);

const HeartSticker = () => (
  <svg viewBox="0 0 40 40" className="w-full h-full">
    <path
      d="M20 34 C 8 24, 6 14, 13 10 C 17 8, 20 11, 20 14 C 20 11, 23 8, 27 10 C 34 14, 32 24, 20 34 Z"
      fill="#e9a89f"
    />
  </svg>
);

const CloudSticker = () => (
  <svg viewBox="0 0 60 40" className="w-full h-full">
    <g fill="#f0eeea">
      <ellipse cx="15" cy="24" rx="10" ry="9" />
      <ellipse cx="30" cy="20" rx="13" ry="11" />
      <ellipse cx="45" cy="24" rx="10" ry="9" />
      <rect x="12" y="24" width="36" height="10" rx="5" />
    </g>
    {/* face */}
    <circle cx="24" cy="24" r="1.3" fill="#2b1a10" />
    <circle cx="36" cy="24" r="1.3" fill="#2b1a10" />
    <path d="M27 27 Q30 29 33 27" stroke="#2b1a10" strokeWidth="1" fill="none" strokeLinecap="round" />
    <circle cx="20" cy="26" r="1.4" fill="#f2a8a0" opacity="0.55" />
    <circle cx="40" cy="26" r="1.4" fill="#f2a8a0" opacity="0.55" />
  </svg>
);

const StarSticker = () => (
  <svg viewBox="0 0 40 40" className="w-full h-full">
    <path
      d="M20 4 L24 15 L36 15 L26 22 L30 33 L20 26 L10 33 L14 22 L4 15 L16 15 Z"
      fill="#e9c37a"
    />
    <circle cx="17" cy="19" r="1.1" fill="#2b1a10" />
    <circle cx="23" cy="19" r="1.1" fill="#2b1a10" />
    <path d="M18 22 Q20 23.5 22 22" stroke="#2b1a10" strokeWidth="0.9" fill="none" strokeLinecap="round" />
  </svg>
);

const CherrySticker = () => (
  <svg viewBox="0 0 50 50" className="w-full h-full">
    {/* stems */}
    <path d="M18 32 C 20 18, 25 10, 30 8" stroke="#8ba85b" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    <path d="M30 32 C 30 18, 32 10, 32 8" stroke="#8ba85b" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    {/* leaf */}
    <path d="M30 8 C 36 6, 40 10, 37 14 C 33 15, 30 12, 30 8 Z" fill="#a3c073" />
    {/* cherries */}
    <circle cx="18" cy="36" r="7" fill="#dd7d7a" />
    <circle cx="30" cy="36" r="7" fill="#dd7d7a" />
    <circle cx="16" cy="34" r="1.8" fill="#f2b5b2" opacity="0.8" />
    <circle cx="28" cy="34" r="1.8" fill="#f2b5b2" opacity="0.8" />
  </svg>
);

const FlowerSticker = () => (
  <svg viewBox="0 0 50 60" className="w-full h-full">
    {/* stem */}
    <path d="M25 50 L25 30" stroke="#8ba85b" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M25 45 Q18 42 15 37" stroke="#8ba85b" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    {/* petals */}
    <g fill="#aec8dc">
      <ellipse cx="25" cy="14" rx="6" ry="8" />
      <ellipse cx="15" cy="22" rx="8" ry="6" />
      <ellipse cx="35" cy="22" rx="8" ry="6" />
      <ellipse cx="25" cy="30" rx="6" ry="8" />
    </g>
    {/* center */}
    <circle cx="25" cy="22" r="3.5" fill="#e9c37a" />
  </svg>
);

// ----- Bento illustration ------------------------------------------------

function BentoBox({ opened }: { opened: boolean }) {
  return (
    <div style={{ width: 540, height: 360, perspective: 1600 }} className="relative">
      {/* soft drop shadow under the box */}
      <div
        className="absolute"
        style={{
          left: "8%",
          right: "8%",
          bottom: -20,
          height: 48,
          background:
            "radial-gradient(ellipse at center, rgba(120, 95, 70, 0.35), transparent 70%)",
          filter: "blur(6px)",
        }}
      />

      {/* base — sage green body (rear) */}
      <div
        className="absolute"
        style={{
          left: 20,
          right: 20,
          top: 130,
          bottom: 20,
          borderRadius: "18px 18px 22px 22px",
          background:
            "linear-gradient(180deg, #b6c4a6 0%, #9bac8e 60%, #8a9c7e 100%)",
          boxShadow:
            "inset 0 -8px 16px rgba(90, 110, 80, 0.35), inset 0 3px 0 rgba(255,255,255,0.25), 0 20px 35px -18px rgba(80, 95, 60, 0.4)",
        }}
      >
        {/* subtle inner band at top (where lid sits) */}
        <div
          className="absolute"
          style={{
            inset: "0 0 auto 0",
            height: 18,
            borderRadius: "18px 18px 0 0",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 100%)",
          }}
        />
        {/* front center pink clasp */}
        <div
          className="absolute"
          style={{
            left: "50%",
            top: -24,
            width: 78,
            height: 46,
            borderRadius: 10,
            background: "linear-gradient(180deg, #ecb1a9 0%, #dd9a93 100%)",
            transform: "translateX(-50%)",
            boxShadow:
              "inset 0 -3px 0 rgba(160, 90, 80, 0.35), inset 0 2px 0 rgba(255,255,255,0.6), 0 6px 10px -4px rgba(120, 70, 60, 0.35)",
          }}
        />
      </div>

      {/* side clasps (pink) */}
      {[
        { left: -6 as number | string, right: undefined },
        { right: -6 as number | string, left: undefined },
      ].map((pos, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            top: 140,
            ...pos,
            width: 34,
            height: 58,
            borderRadius: 10,
            background: "linear-gradient(180deg, #ecb1a9 0%, #dd9a93 100%)",
            boxShadow:
              "inset 0 -3px 0 rgba(160, 90, 80, 0.35), inset 0 2px 0 rgba(255,255,255,0.5), 0 6px 10px -4px rgba(120, 70, 60, 0.35)",
          }}
        />
      ))}

      {/* lid — cream */}
      <motion.div
        className="absolute"
        initial={false}
        animate={
          opened
            ? { y: -220, rotateX: -45, rotateZ: -3, opacity: 0.95 }
            : { y: 0, rotateX: 0, rotateZ: 0, opacity: 1 }
        }
        transition={{ duration: 0.95, ease: [0.2, 0.7, 0.2, 1] }}
        style={{
          left: 10,
          right: 10,
          top: 40,
          height: 200,
          borderRadius: 22,
          background:
            "linear-gradient(180deg, #fbf2de 0%, #f4e9cd 80%, #eadfc2 100%)",
          boxShadow:
            "inset 0 -6px 0 rgba(180, 160, 120, 0.25), inset 0 2px 0 rgba(255,255,255,0.9), 0 14px 24px -10px rgba(120, 100, 70, 0.3)",
          transformOrigin: "top center",
          transformStyle: "preserve-3d",
        }}
      >
        {/* inset panel border */}
        <div
          className="absolute"
          style={{
            inset: 14,
            borderRadius: 16,
            border: "2px solid rgba(220, 200, 160, 0.45)",
          }}
        />

        {/* stickers */}
        <div className="absolute" style={{ left: 56, top: 42, width: 64, height: 64 }}>
          <BearSticker />
        </div>
        <div className="absolute" style={{ left: 160, top: 50, width: 22, height: 22 }}>
          <HeartSticker />
        </div>
        <div className="absolute" style={{ right: 80, top: 40, width: 68, height: 46 }}>
          <CloudSticker />
        </div>
        <div className="absolute" style={{ right: 44, top: 92, width: 34, height: 34 }}>
          <StarSticker />
        </div>
        <div className="absolute" style={{ left: 70, top: 122, width: 50, height: 50 }}>
          <CherrySticker />
        </div>
        <div className="absolute" style={{ right: 76, top: 128, width: 46, height: 54 }}>
          <FlowerSticker />
        </div>
      </motion.div>
    </div>
  );
}

export default function BentoSplash() {
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [geo, setGeo] = useState<GeoState>({ kind: "loading" });

  useEffect(() => {
    const fallback: GeoState = {
      kind: "denied",
      city: CITIES.find((c) => c.key === "sf")!,
    };
    if (!navigator.geolocation) return setGeo(fallback);
    const t = setTimeout(() => setGeo(fallback), 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(t);
        const { latitude, longitude } = pos.coords;
        const nearest = CITIES.filter((c) => c.live).reduce(
          (best, c) => {
            const d = haversineKm(c, latitude, longitude);
            return d < best.d ? { d, c } : best;
          },
          { d: Infinity, c: CITIES[0] },
        ).c;
        setGeo({ kind: "ok", city: nearest, precise: true });
      },
      () => {
        clearTimeout(t);
        setGeo(fallback);
      },
      { timeout: 3500 },
    );
  }, []);

  const nearest = geo.kind === "loading" ? CITIES[0] : geo.city;

  const openAndDive = () => {
    if (opened) return;
    setOpened(true);
    setTimeout(() => router.push(`/${nearest.key}`), 1300);
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#f4ecdc] flex flex-col">
      {/* header copy */}
      <div className="relative z-[2] p-6 md:p-10 max-w-3xl">
        <div className="text-[11px] uppercase tracking-[0.3em] text-neutral-600">
          free food finder
        </div>
        <h1 className="mt-2 font-display text-5xl md:text-7xl font-semibold tracking-tight leading-[0.95] text-neutral-900">
          open the bento.
        </h1>
        <p className="mt-3 text-sm md:text-base text-neutral-600 max-w-md leading-relaxed">
          Every tech event in your city with free food — on a live map.
          We&apos;ll drop you wherever you are.
        </p>
      </div>

      {/* detected-city chip */}
      <div className="absolute top-6 right-6 md:top-10 md:right-10 z-[2]">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/80 backdrop-blur border border-black/5 px-3 py-1.5 text-[11px] font-medium text-neutral-700 shadow-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#5b8def] opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#5b8def]" />
          </span>
          {geo.kind === "loading" && "locating…"}
          {geo.kind === "ok" && (
            <>
              {geo.precise ? "you're near " : "detected "}
              <span className="font-semibold">{geo.city.label}</span>
            </>
          )}
          {geo.kind === "denied" && (
            <>
              defaulting to <span className="font-semibold">{geo.city.label}</span>
            </>
          )}
        </div>
      </div>

      {/* bento */}
      <div className="relative flex-1 grid place-items-center z-[1]">
        <BentoBox opened={opened} />
      </div>

      {/* CTA */}
      <div className="relative z-[2] pb-10 flex justify-center">
        <button
          onClick={openAndDive}
          disabled={opened}
          className="rounded-full bg-neutral-900 text-[#f4ecdc] px-7 py-3.5 text-sm font-semibold shadow-xl hover:bg-neutral-800 transition disabled:opacity-0 disabled:pointer-events-none"
        >
          Open the bento →
        </button>
      </div>

      {/* crossfade to map */}
      <AnimatePresence>
        {opened && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, delay: 0.8, ease: "easeInOut" }}
            className="pointer-events-none absolute inset-0 bg-white z-[5]"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
