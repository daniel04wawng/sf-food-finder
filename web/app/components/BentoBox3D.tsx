"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoundedBox, ContactShadows } from "@react-three/drei";
import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import * as THREE from "three";

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
  { key: "paris", label: "Paris", lat: 48.8566, lng: 2.3522, live: false },
  { key: "berlin", label: "Berlin", lat: 52.52, lng: 13.405, live: false },
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

// --- 3D scene ------------------------------------------------------------

function BentoShell({ opened }: { opened: boolean }) {
  const lidRef = useRef<THREE.Group>(null);
  const rootRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const targetCam = useRef(new THREE.Vector3(0, 3.2, 4.5));
  const targetLook = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    // camera dives into the box once open
    if (opened) {
      targetCam.current.set(0, 0.6, 1.1);
      targetLook.current.set(0, -0.1, 0);
    } else {
      targetCam.current.set(0, 3.2, 4.5);
      targetLook.current.set(0, 0, 0);
    }
  }, [opened]);

  useFrame((_, dt) => {
    if (rootRef.current && !opened) {
      rootRef.current.rotation.y += dt * 0.22;
    }
    if (lidRef.current) {
      const rx = opened ? -Math.PI * 0.95 : 0;
      const py = opened ? 1.3 : 0.28;
      const pz = opened ? -2.1 : 0;
      lidRef.current.rotation.x = THREE.MathUtils.damp(lidRef.current.rotation.x, rx, 5.5, dt);
      lidRef.current.position.y = THREE.MathUtils.damp(lidRef.current.position.y, py, 5.5, dt);
      lidRef.current.position.z = THREE.MathUtils.damp(lidRef.current.position.z, pz, 5.5, dt);
    }
    camera.position.lerp(targetCam.current, opened ? 0.08 : 0.045);
    camera.lookAt(targetLook.current);
  });

  const W = 2.4, H = 0.5, D = 1.7;

  return (
    <group ref={rootRef} position={[0, -0.2, 0]}>
      <RoundedBox args={[W, 0.12, D]} radius={0.05} smoothness={3} position={[0, -H / 2 - 0.05, 0]} receiveShadow castShadow>
        <meshStandardMaterial color="#2d2018" roughness={0.65} />
      </RoundedBox>
      {[
        { pos: [0, 0, D / 2] as [number, number, number], size: [W, H + 0.02, 0.08] as [number, number, number] },
        { pos: [0, 0, -D / 2] as [number, number, number], size: [W, H + 0.02, 0.08] as [number, number, number] },
        { pos: [W / 2, 0, 0] as [number, number, number], size: [0.08, H + 0.02, D] as [number, number, number] },
        { pos: [-W / 2, 0, 0] as [number, number, number], size: [0.08, H + 0.02, D] as [number, number, number] },
      ].map((w, i) => (
        <RoundedBox key={i} args={w.size} radius={0.02} smoothness={3} position={w.pos} receiveShadow castShadow>
          <meshStandardMaterial color="#3d2b1e" roughness={0.7} />
        </RoundedBox>
      ))}
      {/* interior floor — the darkness we "dive into" */}
      <mesh position={[0, -H / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W - 0.14, D - 0.14]} />
        <meshStandardMaterial color="#120c08" roughness={1} />
      </mesh>
      {/* lid */}
      <group ref={lidRef} position={[0, 0.28, 0]}>
        <RoundedBox args={[W + 0.04, 0.08, D + 0.04]} radius={0.04} smoothness={3} castShadow>
          <meshStandardMaterial color="#4c3524" roughness={0.5} />
        </RoundedBox>
        <mesh position={[0, 0.045, 0]}>
          <boxGeometry args={[W * 0.42, 0.012, 0.11]} />
          <meshStandardMaterial color="#eadcc2" roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

// --- Page ----------------------------------------------------------------

export default function BentoBox3D() {
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [geo, setGeo] = useState<GeoState>({ kind: "loading" });

  useEffect(() => {
    const fallback: GeoState = {
      kind: "denied",
      city: CITIES.find((c) => c.key === "sf")!,
    };
    if (!navigator.geolocation) {
      setGeo(fallback);
      return;
    }
    const t = setTimeout(() => setGeo(fallback), 4500);
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
      { timeout: 4000 },
    );
  }, []);

  const nearest = geo.kind === "loading" ? CITIES[0] : geo.city;

  const openAndDive = () => {
    if (opened) return;
    setOpened(true);
    // Let the lid fly + camera dive play, then crossfade to the map.
    setTimeout(() => router.push(`/${nearest.key}`), 1400);
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-gradient-to-b from-[#f8f1e4] to-[#efe3cc]">
      <Canvas shadows camera={{ position: [0, 3.2, 4.5], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true }}>
        <color attach="background" args={["#f8f1e4"]} />
        <ambientLight intensity={0.45} />
        <directionalLight
          position={[4, 7, 3]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <hemisphereLight args={["#fff7e0", "#6b5a45", 0.5]} />
        <BentoShell opened={opened} />
        <ContactShadows position={[0, -0.36, 0]} opacity={0.35} scale={8} blur={2.4} far={1.5} />
      </Canvas>

      {/* header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 p-6 md:p-10 max-w-3xl">
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
      <div className="pointer-events-none absolute top-6 right-6 md:top-10 md:right-10">
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

      {/* CTA — single button */}
      <div className="absolute inset-x-0 bottom-10 flex justify-center">
        <button
          onClick={openAndDive}
          disabled={opened}
          className="pointer-events-auto rounded-full bg-neutral-900 text-[#f8f1e4] px-7 py-3.5 text-sm font-semibold shadow-xl hover:bg-neutral-800 transition disabled:opacity-0 disabled:pointer-events-none"
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
            transition={{ duration: 0.6, delay: 0.85, ease: "easeInOut" }}
            className="pointer-events-none absolute inset-0 bg-white"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
