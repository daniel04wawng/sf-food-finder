import fs from "node:fs/promises";
import path from "node:path";
import CityMap2D from "../components/CityMap2D";
import type { FoodEvent } from "@/lib/types";

async function loadEvents(): Promise<FoodEvent[]> {
  const p = path.join(process.cwd(), "public", "events.json");
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

export default async function SFPage() {
  const events = await loadEvents();
  return <CityMap2D events={events} />;
}
