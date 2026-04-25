"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import type { CircleMarker as LCircleMarker } from "leaflet";
import { format, formatDistanceToNowStrict } from "date-fns";
import type { FoodEvent } from "@/lib/types";
import { SOURCE_FILL } from "./Tracker";

function FlyTo({ coords }: { coords: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!coords) return;
    map.flyTo(coords, Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [coords, map]);
  return null;
}

function SizeFix() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize(false);
    const t1 = setTimeout(fix, 50);
    const t2 = setTimeout(fix, 300);
    window.addEventListener("resize", fix);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", fix);
    };
  }, [map]);
  return null;
}

function shortTimeTo(iso: string) {
  const d = new Date(iso);
  if (d.getTime() < Date.now()) return "past";
  return "in " + formatDistanceToNowStrict(d);
}

export default function TrackerMap({
  events,
  selectedId,
  onSelect,
}: {
  events: FoodEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selectedCoords = useMemo<[number, number] | null>(() => {
    const e = events.find((x) => x.id === selectedId);
    return e ? [e.lat, e.lng] : null;
  }, [events, selectedId]);

  const markerRefs = useRef<Record<string, LCircleMarker | null>>({});
  useEffect(() => {
    if (!selectedId) return;
    const m = markerRefs.current[selectedId];
    if (m) setTimeout(() => m.openPopup(), 400);
  }, [selectedId]);

  return (
    <MapContainer
      center={[37.7749, -122.4194]}
      zoom={13}
      scrollWheelZoom
      zoomControl={false}
      className="h-full w-full"
      style={{ background: "#1a2436" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com">CARTO</a> · <a href="https://osm.org">OSM</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        className="map-tiles-stylized"
      />
      {events.map((e) => {
        const isSelected = e.id === selectedId;
        const radius = isSelected ? 12 : 8;
        const weight = isSelected ? 3 : 2;
        return (
          <React.Fragment key={e.id}>
            {isSelected && (
              <CircleMarker
                center={[e.lat, e.lng]}
                radius={24}
                pathOptions={{
                  color: "#4c3e9e",
                  weight: 0,
                  fillColor: "#4c3e9e",
                  fillOpacity: 0.12,
                  className: "animate-pulse",
                }}
                interactive={false}
              />
            )}
          <CircleMarker
            ref={(ref) => { markerRefs.current[e.id] = ref; }}
            center={[e.lat, e.lng]}
            radius={radius}
            pathOptions={{
              color: "#1a1a1a",
              weight,
              fillColor: "#ffd84a",
              fillOpacity: 1,
            }}
            eventHandlers={{
              click: () => onSelect(e.id),
            }}
          >
            <Popup closeButton={false} maxWidth={320} minWidth={280} offset={[0, -4]}>
              <div className="font-body w-[280px]">
                <div className="flex items-center justify-end mb-2">
                  <span className="text-[10px] text-neutral-400 font-mono tabular-nums">
                    {shortTimeTo(e.start)}
                  </span>
                </div>
                <div className="font-display text-[17px] font-semibold leading-[1.15] tracking-tight mb-1 text-neutral-900">
                  {e.title}
                </div>
                <div className="text-[11px] text-neutral-500 mb-2.5">{e.venue}</div>
                <dl className="text-[11px] divide-y divide-neutral-100 border-y border-neutral-100">
                  <div className="grid grid-cols-[auto_1fr] py-1.5 gap-3">
                    <dt className="text-neutral-500">Date</dt>
                    <dd className="text-right font-mono tabular-nums">
                      {format(new Date(e.start), "EEE MMM d")}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] py-1.5 gap-3">
                    <dt className="text-neutral-500">Time</dt>
                    <dd className="text-right font-mono tabular-nums">
                      {format(new Date(e.start), "h:mm a")} – {format(new Date(e.end), "h:mm a")}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] py-1.5 gap-3">
                    <dt className="text-neutral-500">Food</dt>
                    <dd className="text-right text-neutral-800">{e.foodTypes.join(" · ")}</dd>
                  </div>
                </dl>
                <p className="text-[11.5px] text-neutral-600 leading-[1.55] mt-2.5 mb-2.5 line-clamp-4">
                  {e.description}
                </p>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center w-full bg-neutral-900 text-white text-[11px] font-semibold rounded-full px-3 py-2 hover:bg-neutral-700 transition no-underline"
                >
                  Open event page →
                </a>
              </div>
            </Popup>
          </CircleMarker>
          </React.Fragment>
        );
      })}
      <FlyTo coords={selectedCoords} />
      <SizeFix />
    </MapContainer>
  );
}
