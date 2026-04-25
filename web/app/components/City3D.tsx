"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { format, formatDistanceToNowStrict, parseISO, isWithinInterval, addDays } from "date-fns";
import type { FoodEvent } from "@/lib/types";

// Bbox for SF downtown — used for projecting event lat/lng into our grid
const SF_BBOX: [number, number, number, number] = [37.768, -122.425, 37.805, -122.385];
const M_PER_DEG_LAT = 111_320;
const UNIT_METERS = 8;

function makeProjector(bbox: [number, number, number, number]) {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  return (lat: number, lng: number): [number, number] => {
    const x = ((lng - cx) * mPerDegLng) / UNIT_METERS;
    const z = -((lat - cy) * M_PER_DEG_LAT) / UNIT_METERS;
    return [x, z];
  };
}

// ----- Toon material helper ---------------------------------------------

function makeToonGradient(): THREE.DataTexture {
  // 3-step gradient → flat illustration look
  const colors = new Uint8Array([60, 60, 60, 180, 180, 180, 255, 255, 255]);
  const tex = new THREE.DataTexture(colors, 3, 1, THREE.RGBFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// Cache materials by color so geometry merges nicely
const matCache = new Map<string, THREE.Material>();
function toonMat(color: string, gradientMap: THREE.DataTexture) {
  if (matCache.has(color)) return matCache.get(color)!;
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap });
  matCache.set(color, m);
  return m;
}

// ----- Building templates ------------------------------------------------
// Each returns a THREE.Group sized roughly to a "lot" (W=8, D=8 units)
// Walls + roof + door + windows. All shapes are boxes/cones (super simple).

interface PaletteSet {
  wall: string[];
  roof: string[];
  door: string[];
  trim: string[];
}

const PALETTES: PaletteSet = {
  wall: ["#ffd6c1", "#ffc1c1", "#ffeab8", "#cae8d6", "#cad9ee", "#f5b8cb", "#fff1d6", "#e7c9ee", "#ffce9b", "#d8edcb", "#fce0a8", "#f9d2e0"],
  roof: ["#e07a5f", "#7faa92", "#5b8ec4", "#ee8c7a", "#d08c4a", "#d4718b", "#4a9c9a", "#c4a77d", "#e57a80", "#9c7bb5"],
  door: ["#8b5a3a", "#6e4a32", "#a06a44", "#7a4f33"],
  trim: ["#fff8e8", "#fffdf2", "#ffe9d4"],
};

function pick<T>(arr: T[], rng: () => number): T { return arr[Math.floor(rng() * arr.length)]; }

// Cottage: square base, pitched roof, chimney
function makeCottage(rng: () => number, gm: THREE.DataTexture): THREE.Group {
  const g = new THREE.Group();
  const wallC = pick(PALETTES.wall, rng);
  const roofC = pick(PALETTES.roof, rng);
  const doorC = pick(PALETTES.door, rng);
  const trimC = pick(PALETTES.trim, rng);

  const w = 4.5 + rng() * 1.2;
  const d = 4.0 + rng() * 1.0;
  const h = 2.8 + rng() * 0.8;

  // walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(wallC, gm));
  walls.position.y = h / 2;
  walls.castShadow = walls.receiveShadow = true;
  g.add(walls);

  // pitched roof = wedge prism (made via custom geometry)
  const roofH = 1.6 + rng() * 0.4;
  const roofGeom = new THREE.BufferGeometry();
  const verts = new Float32Array([
    // front face triangle (peak above middle)
    -w / 2, 0, d / 2, w / 2, 0, d / 2, 0, roofH, d / 2,
    // back face triangle
    w / 2, 0, -d / 2, -w / 2, 0, -d / 2, 0, roofH, -d / 2,
    // left slope quad (two tris)
    -w / 2, 0, d / 2, 0, roofH, d / 2, 0, roofH, -d / 2,
    -w / 2, 0, d / 2, 0, roofH, -d / 2, -w / 2, 0, -d / 2,
    // right slope quad
    w / 2, 0, -d / 2, 0, roofH, -d / 2, 0, roofH, d / 2,
    w / 2, 0, -d / 2, 0, roofH, d / 2, w / 2, 0, d / 2,
  ]);
  roofGeom.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  roofGeom.computeVertexNormals();
  const roof = new THREE.Mesh(roofGeom, toonMat(roofC, gm));
  roof.position.y = h;
  roof.castShadow = true;
  g.add(roof);

  // chimney
  if (rng() > 0.4) {
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1, 0.4), toonMat("#a06a44", gm));
    ch.position.set(w / 2 - 0.7, h + roofH * 0.6, 0);
    ch.castShadow = true;
    g.add(ch);
  }

  // door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.05), toonMat(doorC, gm));
  door.position.set(0, 0.7, d / 2 + 0.03);
  g.add(door);

  // windows (small cream squares)
  for (const wx of [-w / 3.5, w / 3.5]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.04), toonMat(trimC, gm));
    win.position.set(wx, h * 0.6, d / 2 + 0.025);
    g.add(win);
  }

  return g;
}

// Row house — narrower, taller, gable roof
function makeRowHouse(rng: () => number, gm: THREE.DataTexture): THREE.Group {
  const g = new THREE.Group();
  const wallC = pick(PALETTES.wall, rng);
  const roofC = pick(PALETTES.roof, rng);
  const doorC = pick(PALETTES.door, rng);
  const trimC = pick(PALETTES.trim, rng);

  const w = 3.5 + rng() * 0.6;
  const d = 5.0 + rng() * 0.6;
  const h = 4.8 + rng() * 0.8;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(wallC, gm));
  walls.position.y = h / 2;
  walls.castShadow = walls.receiveShadow = true;
  g.add(walls);

  // gable roof — triangular prism running w-direction
  const roofH = 1.0 + rng() * 0.5;
  const roofGeom = new THREE.BufferGeometry();
  const v = new Float32Array([
    -w / 2, 0, d / 2, w / 2, 0, d / 2, w / 2, 0, -d / 2,
    -w / 2, 0, d / 2, w / 2, 0, -d / 2, -w / 2, 0, -d / 2,
    -w / 2, 0, d / 2, -w / 2, roofH, 0, w / 2, 0, d / 2,
    w / 2, 0, d / 2, -w / 2, roofH, 0, w / 2, roofH, 0,
    w / 2, 0, -d / 2, -w / 2, roofH, 0, -w / 2, 0, -d / 2,
    -w / 2, roofH, 0, w / 2, 0, -d / 2, w / 2, roofH, 0,
    -w / 2, 0, d / 2, -w / 2, 0, -d / 2, -w / 2, roofH, 0,
    w / 2, 0, d / 2, w / 2, roofH, 0, w / 2, 0, -d / 2,
  ]);
  roofGeom.setAttribute("position", new THREE.BufferAttribute(v, 3));
  roofGeom.computeVertexNormals();
  const roof = new THREE.Mesh(roofGeom, toonMat(roofC, gm));
  roof.position.y = h;
  roof.castShadow = true;
  g.add(roof);

  // door + bay window
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.05), toonMat(doorC, gm));
  door.position.set(-w / 4, 0.75, d / 2 + 0.03);
  g.add(door);
  // bay window — protrusion
  const bay = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.4), toonMat(trimC, gm));
  bay.position.set(w / 5, h * 0.55, d / 2 + 0.2);
  g.add(bay);
  // window grid on bay
  for (let i = 0; i < 3; i++) {
    const ww = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.03), toonMat("#5b8ec4", gm));
    ww.position.set(w / 5 - 0.4 + i * 0.4, h * 0.55, d / 2 + 0.41);
    g.add(ww);
  }
  // upper windows
  for (let i = 0; i < 2; i++) {
    const ww = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.03), toonMat(trimC, gm));
    ww.position.set(-w / 4 + i * (w / 2), h * 0.85, d / 2 + 0.025);
    g.add(ww);
  }

  return g;
}

// Shop — wide flat front with awning
function makeShop(rng: () => number, gm: THREE.DataTexture): THREE.Group {
  const g = new THREE.Group();
  const wallC = pick(PALETTES.wall, rng);
  const roofC = pick(PALETTES.roof, rng);
  const trimC = pick(PALETTES.trim, rng);
  const awnC = pick(PALETTES.roof, rng);

  const w = 6.5 + rng() * 1.2;
  const d = 5.0 + rng() * 0.8;
  const h = 3.2 + rng() * 0.6;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(wallC, gm));
  walls.position.y = h / 2;
  walls.castShadow = walls.receiveShadow = true;
  g.add(walls);

  // flat-ish roof slab
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), toonMat(roofC, gm));
  roof.position.y = h + 0.25;
  roof.castShadow = true;
  g.add(roof);

  // big storefront window
  const window = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 1.5, 0.04), toonMat("#cfe1ec", gm));
  window.position.set(0, 1.1, d / 2 + 0.025);
  g.add(window);

  // awning — striped angled slab
  const aw = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.15, 1.4), toonMat(awnC, gm));
  aw.position.set(0, 2.1, d / 2 + 0.7);
  aw.rotation.x = -0.18;
  aw.castShadow = true;
  g.add(aw);

  // door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2, 0.05), toonMat(trimC, gm));
  door.position.set(w * 0.32, 1, d / 2 + 0.03);
  g.add(door);

  return g;
}

// Mid-rise — taller box with banded windows
function makeMidRise(rng: () => number, gm: THREE.DataTexture): THREE.Group {
  const g = new THREE.Group();
  const wallC = pick(PALETTES.wall, rng);
  const roofC = pick(PALETTES.roof, rng);
  const winC = "#a8c8e0";

  const w = 5.5 + rng() * 1.2;
  const d = 5.0 + rng() * 1.0;
  const floors = 3 + Math.floor(rng() * 4);
  const fh = 2.2;
  const h = floors * fh;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(wallC, gm));
  walls.position.y = h / 2;
  walls.castShadow = walls.receiveShadow = true;
  g.add(walls);

  // top slab
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3), toonMat(roofC, gm));
  cap.position.y = h + 0.2;
  cap.castShadow = true;
  g.add(cap);

  // window bands
  for (let f = 0; f < floors; f++) {
    const y = (f + 0.5) * fh;
    // front
    const fb = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, 0.9, 0.04), toonMat(winC, gm));
    fb.position.set(0, y, d / 2 + 0.025);
    g.add(fb);
    // back
    const bb = fb.clone();
    bb.position.z = -d / 2 - 0.025;
    g.add(bb);
    // sides
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, d * 0.78), toonMat(winC, gm));
    lb.position.set(-w / 2 - 0.025, y, 0);
    g.add(lb);
    const rb = lb.clone();
    rb.position.x = w / 2 + 0.025;
    g.add(rb);
  }
  return g;
}

// Skyscraper — tall stepped tower
function makeTower(rng: () => number, gm: THREE.DataTexture): THREE.Group {
  const g = new THREE.Group();
  const wallC = pick(PALETTES.wall, rng);
  const roofC = pick(PALETTES.roof, rng);
  const winC = "#9bbfe3";

  const w = 4 + rng() * 1.2;
  const d = 4 + rng() * 1.2;
  const h = 14 + rng() * 12;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(wallC, gm));
  walls.position.y = h / 2;
  walls.castShadow = walls.receiveShadow = true;
  g.add(walls);

  // stepped top
  const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 1.5, d * 0.7), toonMat(wallC, gm));
  top.position.y = h + 0.75;
  top.castShadow = true;
  g.add(top);

  // crown
  const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 0.6, d * 0.4), toonMat(roofC, gm));
  crown.position.y = h + 1.8;
  crown.castShadow = true;
  g.add(crown);

  // window stripes (vertical bands on each face)
  const stripeW = 0.35;
  const cols = 3;
  for (let i = 0; i < cols; i++) {
    const x = -w / 2.6 + i * (w / 3.2);
    const stripeF = new THREE.Mesh(new THREE.BoxGeometry(stripeW, h * 0.85, 0.04), toonMat(winC, gm));
    stripeF.position.set(x, h / 2, d / 2 + 0.025);
    g.add(stripeF);
    const stripeB = stripeF.clone();
    stripeB.position.z = -d / 2 - 0.025;
    g.add(stripeB);
  }
  return g;
}

// Victorian (painted lady) — like rowhouse but ornate
function makeVictorian(rng: () => number, gm: THREE.DataTexture): THREE.Group {
  const g = makeRowHouse(rng, gm);
  // Add a turret/cupola on top corner
  const wallC = pick(PALETTES.wall, rng);
  const roofC = pick(PALETTES.roof, rng);
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 8), toonMat(wallC, gm));
  turret.position.set(1.2, 5, 1.5);
  turret.castShadow = true;
  g.add(turret);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.4, 8), toonMat(roofC, gm));
  spire.position.set(1.2, 6.4, 1.5);
  spire.castShadow = true;
  g.add(spire);
  return g;
}

const TEMPLATES = [makeCottage, makeRowHouse, makeShop, makeMidRise, makeTower, makeVictorian];
// Weights — smaller buildings are common, towers rarer
const TEMPLATE_WEIGHTS = [3, 4, 2, 2, 0.7, 1.2];

function pickTemplateWeighted(rng: () => number) {
  const total = TEMPLATE_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < TEMPLATES.length; i++) {
    r -= TEMPLATE_WEIGHTS[i];
    if (r <= 0) return TEMPLATES[i];
  }
  return TEMPLATES[0];
}

// ----- Tree / lamppost / car ---------------------------------------------

function makeTree(rng: () => number, gm: THREE.DataTexture): THREE.Group {
  const g = new THREE.Group();
  const leaf = pick(["#92c075", "#a7d088", "#7fb465", "#b9dd97"], rng);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.4, 6), toonMat("#7a5533", gm));
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.95 + rng() * 0.4, 12, 10), toonMat(leaf, gm));
  leaves.position.y = 1.7;
  leaves.scale.y = 1.15 + rng() * 0.2;
  leaves.castShadow = true;
  g.add(leaves);
  return g;
}

function makeCar(rng: () => number, gm: THREE.DataTexture): THREE.Group {
  const g = new THREE.Group();
  const colors = ["#e07a5f", "#5b8ec4", "#f4d35e", "#7faa92", "#d4718b", "#fff8e8"];
  const c = pick(colors, rng);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 1), toonMat(c, gm));
  body.position.y = 0.4;
  body.castShadow = true;
  g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.9), toonMat(c, gm));
  cab.position.set(-0.1, 0.95, 0);
  cab.castShadow = true;
  g.add(cab);
  for (const [x, z] of [[-0.7, 0.5], [0.7, 0.5], [-0.7, -0.5], [0.7, -0.5]] as [number, number][]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.15, 12), toonMat("#222", gm));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.18, z);
    g.add(w);
  }
  return g;
}

function makeLamppost(gm: THREE.DataTexture): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6), toonMat("#3b3b3b", gm));
  pole.position.y = 1.25;
  g.add(pole);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), toonMat("#fff3aa", gm));
  lamp.position.y = 2.55;
  g.add(lamp);
  return g;
}

// ----- Procedural city layout --------------------------------------------

function buildToyCity(gm: THREE.DataTexture): THREE.Group {
  const root = new THREE.Group();

  // Define grid: 11 cols × 9 rows of "blocks", each 12×12 units, with 4-unit street between
  const COLS = 11;
  const ROWS = 9;
  const BLOCK = 12;
  const STREET = 4;
  const PITCH = BLOCK + STREET; // distance between block centers
  const totalW = COLS * PITCH;
  const totalD = ROWS * PITCH;

  // Ground (warm cream)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(totalW + 100, totalD + 100),
    toonMat("#f4ddae", gm),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  root.add(ground);

  // Streets — dark slabs spanning the grid (hor + vert)
  const streetMat = toonMat("#5d503e", gm);
  for (let r = 0; r <= ROWS; r++) {
    const z = -totalD / 2 + r * PITCH - STREET / 2;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(totalW, STREET), streetMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(0, 0, z + STREET / 2);
    s.receiveShadow = true;
    root.add(s);
  }
  for (let c = 0; c <= COLS; c++) {
    const x = -totalW / 2 + c * PITCH - STREET / 2;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(STREET, totalD), streetMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x + STREET / 2, 0, 0);
    s.receiveShadow = true;
    root.add(s);
  }
  // Street centerline (yellow dashes) — just a single texture per long street, simplified
  // (skipped for clarity)

  // Park: some random blocks → green park instead of buildings
  // Seeded random so layout is stable
  let seed = 31337;
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  const isPark = new Set<string>();
  const numParks = 8;
  for (let i = 0; i < numParks; i++) {
    isPark.add(`${Math.floor(rng() * COLS)},${Math.floor(rng() * ROWS)}`);
  }

  // For each block, place 2-4 buildings around the perimeter
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const cx = -totalW / 2 + (c + 0.5) * PITCH - STREET / 2;
      const cz = -totalD / 2 + (r + 0.5) * PITCH - STREET / 2;

      if (isPark.has(`${c},${r}`)) {
        // Park — circular green patch + extra trees
        const park = new THREE.Mesh(new THREE.CircleGeometry(BLOCK * 0.42, 28), toonMat("#b0d590", gm));
        park.rotation.x = -Math.PI / 2;
        park.position.set(cx, 0.005, cz);
        park.receiveShadow = true;
        root.add(park);
        for (let t = 0; t < 6; t++) {
          const tree = makeTree(rng, gm);
          const ang = rng() * Math.PI * 2;
          const rad = 1.5 + rng() * (BLOCK / 2.6);
          tree.position.set(cx + Math.cos(ang) * rad, 0, cz + Math.sin(ang) * rad);
          root.add(tree);
        }
        continue;
      }

      // Place buildings along the block — 2x2 grid with skip chance
      const slots: [number, number][] = [
        [-BLOCK / 4, -BLOCK / 4],
        [BLOCK / 4, -BLOCK / 4],
        [-BLOCK / 4, BLOCK / 4],
        [BLOCK / 4, BLOCK / 4],
      ];
      for (const [ox, oz] of slots) {
        if (rng() < 0.18) continue; // empty lot
        const tpl = pickTemplateWeighted(rng);
        const bld = tpl(rng, gm);
        // small jitter
        bld.position.set(cx + ox + (rng() - 0.5) * 0.6, 0, cz + oz + (rng() - 0.5) * 0.6);
        bld.rotation.y = Math.PI / 2 * Math.floor(rng() * 4);
        root.add(bld);
      }
      // a tree or two at corners
      if (rng() > 0.4) {
        const tree = makeTree(rng, gm);
        tree.position.set(cx - BLOCK / 2 + 0.6, 0, cz - BLOCK / 2 + 0.6);
        root.add(tree);
      }
      if (rng() > 0.5) {
        const tree = makeTree(rng, gm);
        tree.position.set(cx + BLOCK / 2 - 0.6, 0, cz + BLOCK / 2 - 0.6);
        root.add(tree);
      }
    }
  }

  // Cars on streets
  for (let i = 0; i < 60; i++) {
    const horizontal = rng() > 0.5;
    if (horizontal) {
      const r = Math.floor(rng() * (ROWS + 1));
      const z = -totalD / 2 + r * PITCH - STREET / 2 + STREET / 2;
      const x = -totalW / 2 + rng() * totalW;
      const car = makeCar(rng, gm);
      car.position.set(x, 0, z);
      root.add(car);
    } else {
      const c = Math.floor(rng() * (COLS + 1));
      const x = -totalW / 2 + c * PITCH - STREET / 2 + STREET / 2;
      const z = -totalD / 2 + rng() * totalD;
      const car = makeCar(rng, gm);
      car.position.set(x, 0, z);
      car.rotation.y = Math.PI / 2;
      root.add(car);
    }
  }

  // Lampposts at intersections
  for (let c = 0; c <= COLS; c++) {
    for (let r = 0; r <= ROWS; r++) {
      if ((c + r) % 3 !== 0) continue;
      const x = -totalW / 2 + c * PITCH - STREET / 2;
      const z = -totalD / 2 + r * PITCH - STREET / 2;
      const lamp = makeLamppost(gm);
      lamp.position.set(x, 0, z);
      root.add(lamp);
    }
  }

  // Water plane around the city, slightly lower
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    toonMat("#aacfdf", gm),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.5;
  root.add(water);

  return root;
}

// ----- Pin ---------------------------------------------------------------

function makePinMesh(x: number, z: number, selected: boolean, gm: THREE.DataTexture): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.5, 8), toonMat("#1a1a1a", gm));
  stem.position.y = 2.25;
  stem.castShadow = true;
  g.add(stem);
  const head = new THREE.Mesh(new THREE.SphereGeometry(selected ? 0.85 : 0.62, 20, 14), toonMat("#ffd84a", gm));
  head.position.y = 4.5;
  head.castShadow = true;
  g.add(head);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 0.85, 24),
    new THREE.MeshBasicMaterial({ color: "#ffd84a", transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);
  return g;
}

// ----- Component ---------------------------------------------------------

function shortTimeTo(iso: string) {
  const d = new Date(iso);
  if (d.getTime() < Date.now()) return "past";
  return "in " + formatDistanceToNowStrict(d);
}
function todayISO() { return format(new Date(), "yyyy-MM-dd"); }

export default function City3D({ events }: { events: FoodEvent[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [sheetOpen, setSheetOpen] = useState(false);

  const project = useMemo(() => makeProjector(SF_BBOX), []);

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

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    pinGroup: THREE.Group;
    project: (lat: number, lng: number) => [number, number];
    pinToEventId: Map<THREE.Object3D, string>;
    gradientMap: THREE.DataTexture;
  } | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(new THREE.Color("#fae8c8"));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const gradientMap = makeToonGradient();

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#fae8c8", 220, 480);

    const camera = new THREE.PerspectiveCamera(35, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    camera.position.set(110, 130, 140);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 40;
    controls.maxDistance = 380;
    controls.minPolarAngle = Math.PI / 6;
    controls.maxPolarAngle = Math.PI / 2.3;

    // Lights — soft directional + warm ambient/hemi
    scene.add(new THREE.AmbientLight(0xfff3dc, 0.85));
    scene.add(new THREE.HemisphereLight(0xfff1d8, 0xddc28a, 0.6));
    const dir = new THREE.DirectionalLight(0xfff0d0, 1.0);
    dir.position.set(80, 150, 60);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -180;
    dir.shadow.camera.right = 180;
    dir.shadow.camera.top = 180;
    dir.shadow.camera.bottom = -180;
    dir.shadow.camera.near = 10;
    dir.shadow.camera.far = 500;
    scene.add(dir);

    // Build city
    scene.add(buildToyCity(gradientMap));

    // Pins group
    const pinGroup = new THREE.Group();
    scene.add(pinGroup);
    const pinToEventId = new Map<THREE.Object3D, string>();

    sceneRef.current = { renderer, scene, camera, controls, pinGroup, project, pinToEventId, gradientMap };

    let rafId = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(loop);
    };
    loop();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(pinGroup.children, true);
      for (const h of hits) {
        let obj: THREE.Object3D | null = h.object;
        while (obj) {
          const id = pinToEventId.get(obj);
          if (id) { setSelectedId(id); return; }
          obj = obj.parent;
        }
      }
    };
    renderer.domElement.addEventListener("click", onClick);

    setReady(true);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    while (s.pinGroup.children.length) s.pinGroup.remove(s.pinGroup.children[0]);
    s.pinToEventId.clear();
    for (const e of filtered) {
      const [x, z] = s.project(e.lat, e.lng);
      const pin = makePinMesh(x, z, e.id === selectedId, s.gradientMap);
      s.pinGroup.add(pin);
      pin.traverse((obj) => s.pinToEventId.set(obj, e.id));
    }
  }, [filtered, selectedId, ready]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !selected) return;
    const [x, z] = s.project(selected.lat, selected.lng);
    const end = new THREE.Vector3(x, 0, z);
    const start = s.controls.target.clone();
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 600);
      const e = 1 - Math.pow(1 - t, 3);
      s.controls.target.lerpVectors(start, end, e);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [selected]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-gradient-to-b from-[#fae8c8] to-[#f3d4a3]">
      <div ref={mountRef} className="absolute inset-0" />

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

      {!ready && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none z-[5]">
          <div className="text-sm text-neutral-700 bg-white/80 backdrop-blur rounded-full px-4 py-2 border border-black/5 shadow">
            building the city…
          </div>
        </div>
      )}

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
