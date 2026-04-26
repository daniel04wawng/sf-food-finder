"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import type { FoodEvent } from "@/lib/types";
import { format } from "date-fns";

const SOURCE_COLORS: Record<string, string> = {
  Luma: "#f7c6d0",
  "Cerebral Valley": "#c8e0b4",
  X: "#ffd2b5",
  Eventbrite: "#ffe39a",
  Meetup: "#b8d8ea",
};

function makeIcon(emoji: string, bg: string) {
  return L.divIcon({
    className: "",
    html: `<div class="pin" style="background:${bg}">${emoji}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -36],
  });
}

export default function MapView({
  events,
  onSelect,
}: {
  events: FoodEvent[];
  onSelect: (e: FoodEvent) => void;
}) {
  return (
    <MapContainer
      center={[37.7849, -122.4094]}
      zoom={13}
      scrollWheelZoom
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />
      {events.map((e) => {
        const emoji = e.foodTypes[0]?.split(" ")[0] ?? "🍱";
        const bg = SOURCE_COLORS[e.source] ?? "#ffd2b5";
        return (
          <Marker
            key={e.id}
            position={[e.lat, e.lng]}
            icon={makeIcon(emoji, bg)}
            eventHandlers={{ click: () => onSelect(e) }}
          >
            <Popup>
              <div className="font-sans">
                <div className="font-bold text-sm mb-1">{e.title}</div>
                <div className="text-xs opacity-70 mb-1">{e.venue}</div>
                <div className="text-xs mb-2">
                  {format(new Date(e.start), "EEE MMM d · h:mm a")}
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {e.foodTypes.map((f) => (
                    <span
                      key={f}
                      className="text-[11px] bg-[var(--accent-tamago)] rounded-full px-2 py-0.5"
                    >
                      {f}
                    </span>
                  ))}
                </div>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold underline"
                >
                  Open event →
                </a>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
