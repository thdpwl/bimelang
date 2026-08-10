// CAD(파싱된 primitive) → BIM 요소 변환.
// 레이어별 매핑(mapping)과 변환 옵션(options)을 받아 model.elements 배열을 만든다.
import { createWall, createSlab, createColumn, createDoor, createWindow } from "./model.js";

export const TYPES = ["wall", "column", "door", "window", "slab", "roof", "ignore"];
export const TYPE_LABEL = { wall: "벽", column: "기둥", door: "문", window: "창(창문)", slab: "바닥(슬래브)", roof: "지붕", ignore: "무시" };

// 레이어 이름으로 객체 타입 자동 추정
export function guessType(layer) {
  const n = layer.toLowerCase();
  if (/(door|문|출입|dr\b)/.test(n)) return "door";
  if (/(window|창|win|sash|glaz)/.test(n)) return "window";
  if (/(wall|벽|wal|w-)/.test(n)) return "wall";
  if (/(col|기둥|pillar|column|c-)/.test(n)) return "column";
  if (/(roof|지붕|rf)/.test(n)) return "roof";
  if (/(slab|floor|바닥|슬래브|flr|s-)/.test(n)) return "slab";
  return "ignore";
}

export function defaultOptions(scale = 1) {
  return {
    scale,            // 도면 단위 → mm
    wallHeight: 3000,
    wallThickness: 200,    // 단일선(짝 없는 선)일 때 적용할 기본 두께
    pairWalls: true,       // 벽 양면선(평행 2선)을 두께 있는 벽 1개로 병합
    wallPairMaxGap: 400,   // 두 선 사이 최대 거리(mm). 이보다 멀면 별개의 벽으로 본다.
    wallJoinGap: 1000,     // 같은 직선 위 벽 조각을 이을 최대 틈(mm). 문·기둥으로 끊긴 벽을 연결.
    columnHeight: 3000,
    // 문·창: 평면도엔 높이 정보가 없으므로 사용자가 조절하는 기본값.
    doorHeight: 2100,      // 문 높이
    doorSill: 0,           // 문 하단이 바닥에서 띄워진 높이
    windowHeight: 1000,    // 창 높이
    windowSill: 1200,      // 창 하단이 바닥에서 띄워진 높이(창대 높이)
    slabThickness: 250,
    roofThickness: 250,
    roofElevation: 3000,
    // 단면도·입면도에서 산정한 층 레벨로 바닥·지붕 자동 생성.
    autoFloors: true,      // 레벨별 바닥/지붕 자동 생성 on/off
    floorLevels: null,     // [0, 3000, ...] 층 레벨(mm). 단면도/입면도 없으면 null → 자동 생성 안 함.
  };
}

export function convert(primitives, mapping, options) {
  const o = options;
  const s = o.scale;
  const sp = ([x, y]) => [x * s, y * s];
  const out = [];
  const wallPts = []; // 자동 바닥·지붕 외곽 산정용(mm 좌표)

  // 기둥 footprint(도면 단위) — 벽에서 기둥 구간을 잘라내는 데 쓴다.
  const columnBoxes = collectColumnBoxes(primitives, mapping);

  // 벽: 전체 선을 모아 평행 2선 → 두께 있는 벽 1개로 병합,
  // 그다음 기둥과 겹치는 구간을 잘라내 조각으로 나눠 생성한다(벽·기둥 중복 방지).
  for (const job of buildWallJobs(primitives, mapping, o)) {
    for (const piece of subtractColumns(job, columnBoxes, o)) {
      const start = sp(piece.start), end = sp(piece.end);
      wallPts.push(start, end);
      out.push(createWall({
        name: `벽 (${piece.layer})`,
        start, end,
        height: o.wallHeight,
        // 짝지어진 벽은 도면에서 측정한 두께, 단일선은 기본 두께
        thickness: piece.paired ? Math.max(1, Math.round(piece.thicknessDU * s)) : o.wallThickness,
        elevation: 0,
      }));
    }
  }

  for (const p of primitives) {
    const t = mapping[p.layer] || "ignore";
    if (t === "ignore" || t === "wall") continue;

    if (t === "column") {
      const col = columnFrom(p);
      if (col) {
        out.push(createColumn({
          name: `기둥 (${p.layer})`,
          position: sp(col.center),
          width: col.w * s, depth: col.d * s,
          height: o.columnHeight, elevation: 0,
        }));
      }
    } else if (t === "slab" || t === "roof") {
      if (p.kind === "polyline" && p.points.length >= 3) {
        out.push(createSlab({
          name: t === "roof" ? `지붕 (${p.layer})` : `바닥 (${p.layer})`,
          polygon: p.points.map(sp),
          thickness: t === "roof" ? o.roofThickness : o.slabThickness,
          elevation: t === "roof" ? o.roofElevation : 0,
        }));
      }
    }
  }

  // 문·창: 벽을 다 만든 뒤(위) 도면의 문·창 박스를 감지해 가장 가까운 벽에 호스팅한다.
  const walls = out.filter((e) => e.type === "wall");
  for (const type of ["door", "window"]) {
    for (const box of openingBoxes(primitives, mapping, type, o)) {
      out.push(makeOpening(type, box, walls, o, sp));
    }
  }

  // 단면도·입면도에서 산정한 층 레벨로 바닥·지붕 자동 생성.
  // 외곽(footprint)은 벽 중심선의 bbox → 없으면 전체 도형 bbox.
  if (o.autoFloors && Array.isArray(o.floorLevels) && o.floorLevels.length) {
    const footprint = footprintFromPoints(wallPts) || allPointsFootprint(primitives, sp);
    if (footprint) {
      for (const item of levelSlabs(o.floorLevels, o)) {
        out.push(createSlab({
          name: item.name,
          polygon: footprint,
          thickness: item.thickness,
          elevation: item.elevation,
        }));
      }
    }
  }
  return out;
}

// 층 레벨 배열 → 생성할 바닥/지붕 목록. 최상단 레벨은 지붕으로 본다.
function levelSlabs(levels, o) {
  const sorted = [...levels].sort((a, b) => a - b);
  const items = [];
  sorted.forEach((elev, i) => {
    const isRoof = sorted.length > 1 && i === sorted.length - 1;
    items.push({
      name: isRoof ? "지붕 (자동)" : `바닥 ${i + 1}층 (자동)`,
      thickness: isRoof ? o.roofThickness : o.slabThickness,
      elevation: elev,
    });
  });
  return items;
}

// 점들의 축정렬 bbox → 직사각형 footprint. 너무 작으면 null.
function footprintFromPoints(pts) {
  if (!pts || pts.length < 2) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  if (maxX - minX < 1 || maxY - minY < 1) return null;
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}

// 벽이 없을 때: 전체 도형의 bbox를 footprint로.
function allPointsFootprint(primitives, sp) {
  const pts = [];
  for (const p of primitives) {
    if (p.points) for (const q of p.points) pts.push(sp(q));
    else if (p.kind === "circle") {
      pts.push(sp([p.center[0] - p.radius, p.center[1] - p.radius]));
      pts.push(sp([p.center[0] + p.radius, p.center[1] + p.radius]));
    }
  }
  return footprintFromPoints(pts);
}

// 변환 결과 요약 (미리보기용)
export function preview(primitives, mapping, options) {
  const o = options || defaultOptions();
  const c = { wall: 0, column: 0, door: 0, window: 0, slab: 0, roof: 0 };
  const columnBoxes = collectColumnBoxes(primitives, mapping);
  for (const job of buildWallJobs(primitives, mapping, o)) {
    c.wall += subtractColumns(job, columnBoxes, o).length;
  }
  c.door = openingBoxes(primitives, mapping, "door", o).length;
  c.window = openingBoxes(primitives, mapping, "window", o).length;
  for (const p of primitives) {
    const t = mapping[p.layer] || "ignore";
    if (t === "column") { if (columnFrom(p)) c.column++; }
    else if (t === "slab") { if (p.kind === "polyline" && p.points.length >= 3) c.slab++; }
    else if (t === "roof") { if (p.kind === "polyline" && p.points.length >= 3) c.roof++; }
  }
  // 단면도·입면도 기반 자동 바닥·지붕
  if (o.autoFloors && Array.isArray(o.floorLevels) && o.floorLevels.length) {
    const n = o.floorLevels.length;
    if (n > 1) { c.slab += n - 1; c.roof += 1; }
    else c.slab += 1;
  }
  return c;
}

// ── 벽 생성 작업 목록 ────────────────────────────────────────────────
// 벽으로 매핑된 모든 선/폴리라인을 세그먼트로 분해한 뒤,
// pairWalls 옵션이 켜져 있으면 평행한 두 선을 두께 있는 벽 1개로 병합한다.
// 반환: [{ start:[x,y], end:[x,y], layer, paired, thicknessDU }]
//   - paired=true 면 thicknessDU(도면 단위 두께)가 채워짐
//   - paired=false 면 짝 없는 단일선 (기본 두께로 생성)
function buildWallJobs(primitives, mapping, o) {
  const segs = [];
  for (const p of primitives) {
    if ((mapping[p.layer] || "ignore") !== "wall") continue;
    for (const [a, b] of segments(p)) {
      if (dist(a, b) < 1) continue;
      segs.push({ a, b, layer: p.layer });
    }
  }
  if (o.pairWalls === false) {
    return segs.map((g) => ({ start: g.a, end: g.b, layer: g.layer, paired: false }));
  }
  // 평행쌍 → 두께 벽, 그 다음 같은 직선 위 끊긴 조각들을 하나로 잇는다.
  return mergeCollinearWalls(pairWallSegments(segs, o), o);
}

// 같은 직선 위에서 문·기둥으로 끊긴 벽 조각들을 하나의 벽으로 잇는다.
function mergeCollinearWalls(jobs, o) {
  const scale = o.scale || 1;
  const joinGap = (o.wallJoinGap ?? 1000) / scale;
  const offTol = 30 / scale;   // 같은 직선으로 볼 수직거리 오차(≈30mm)

  const groups = new Map();
  for (const j of jobs) {
    let [dx, dy] = unit(sub(j.end, j.start));
    if (dx < 0 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; } // 방향을 [0,180)로 정규화
    const offset = dx * j.start[1] - dy * j.start[0]; // 원점에서 직선까지의 부호 있는 수직거리
    const thKey = j.paired ? Math.round((j.thicknessDU * scale) / 10) : "S";
    const key = [Math.round(dx * 1000), Math.round(dy * 1000), Math.round(offset / offTol), thKey, j.layer].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }

  const out = [];
  for (const grp of groups.values()) {
    const dir = unit(sub(grp[0].end, grp[0].start));
    const o0 = grp[0].start;
    const proj = (p) => dot(sub(p, o0), dir);
    const items = grp.map((j) => {
      const t0 = proj(j.start), t1 = proj(j.end);
      return { lo: Math.min(t0, t1), hi: Math.max(t0, t1), thicknessDU: j.thicknessDU || 0, paired: j.paired, layer: j.layer };
    }).sort((a, b) => a.lo - b.lo);

    let cur = { ...items[0] };
    const flush = () => out.push({
      start: add(o0, mul(dir, cur.lo)), end: add(o0, mul(dir, cur.hi)),
      thicknessDU: cur.thicknessDU, paired: cur.paired, layer: cur.layer,
    });
    for (let k = 1; k < items.length; k++) {
      const it = items[k];
      if (it.lo - cur.hi <= joinGap) {                 // 틈이 joinGap 이하면 잇는다
        cur.hi = Math.max(cur.hi, it.hi);
        cur.thicknessDU = Math.max(cur.thicknessDU, it.thicknessDU);
        cur.paired = cur.paired || it.paired;
      } else { flush(); cur = { ...it }; }
    }
    flush();
  }
  return out;
}

// 평행·근접·중첩하는 두 면 선을 두께 있는 벽으로 묶는다.
// 1:1 독점 매칭이 아니라 "유효한 모든 쌍"을 처리하므로
// 긴 면 선 1개가 (기둥·교차벽으로 쪼개진) 짧은 면 선 여러 개와 각각 짝지어진다.
function pairWallSegments(segs, o) {
  const scale = o.scale || 1;
  const maxGap = (o.wallPairMaxGap ?? 400) / scale;  // mm → 도면 단위
  const minGap = 1 / scale;                          // 겹친(중복) 선 제외용 하한
  const angTol = 0.16;        // 평행 허용 오차 (sin ≈ 9°)
  const minOverlapRatio = 0.5; // 짧은 선 길이 대비 겹침 비율

  const jobs = [];
  const hadPartner = new Array(segs.length).fill(false);
  const seen = new Set();     // 동일 중심선 중복 생성 방지

  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const m = tryPair(segs[i], segs[j], { minGap, maxGap, angTol, minOverlapRatio });
      if (!m) continue;
      hadPartner[i] = hadPartner[j] = true;
      const key = wallKey(m.start, m.end);
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ start: m.start, end: m.end, thicknessDU: m.gap, layer: segs[i].layer, paired: true });
    }
  }

  // 짝이 전혀 없던 선만 단일선 벽(기본 두께)으로 생성
  for (let i = 0; i < segs.length; i++) {
    if (!hadPartner[i]) jobs.push({ start: segs[i].a, end: segs[i].b, layer: segs[i].layer, paired: false });
  }
  return jobs;
}

// 중심선을 100mm 격자로 양자화한 방향-무관 키 (중복 벽 제거용)
function wallKey(a, b) {
  const r = (v) => Math.round(v / 100);
  const k1 = `${r(a[0])},${r(a[1])}`, k2 = `${r(b[0])},${r(b[1])}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

// 두 세그먼트가 벽 양면을 이루는지 검사. 맞으면 {start,end,gap} 반환, 아니면 null
function tryPair(A, B, t) {
  let a0 = A.a, a1 = A.b, b0 = B.a, b1 = B.b;
  const dirA = unit(sub(a1, a0));
  let dirB = unit(sub(b1, b0));
  if (dot(dirA, dirB) < 0) { [b0, b1] = [b1, b0]; dirB = unit(sub(b1, b0)); }

  if (Math.abs(cross(dirA, dirB)) > t.angTol) return null;        // 평행 아님

  const gap = Math.abs(cross(sub(b0, a0), dirA));                 // A선까지의 수직거리
  if (gap < t.minGap || gap > t.maxGap) return null;             // 두께 범위 밖

  const dir = unit(add(dirA, dirB));                             // 평균 방향
  const proj = (p) => dot(sub(p, a0), dir);
  const tA = [proj(a0), proj(a1)].sort((x, y) => x - y);
  const tB = [proj(b0), proj(b1)].sort((x, y) => x - y);
  const lo = Math.max(tA[0], tB[0]);
  const hi = Math.min(tA[1], tB[1]);
  const overlap = hi - lo;
  if (overlap <= 0) return null;                                 // 길이방향 겹침 없음
  if (overlap < t.minOverlapRatio * Math.min(tA[1] - tA[0], tB[1] - tB[0])) return null;

  // 겹친 구간의 양 끝에서 두 선의 중점 → 중심선
  const pointOnA = (tt) => add(a0, mul(dirA, tt / dot(dirA, dir)));
  const offB = dot(sub(b0, a0), dir);
  const pointOnB = (tt) => add(b0, mul(dirB, (tt - offB) / dot(dirB, dir)));
  const start = mid(pointOnA(lo), pointOnB(lo));
  const end = mid(pointOnA(hi), pointOnB(hi));
  return { start, end, gap };
}

// 2D 벡터 유틸
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const mul = (p, k) => [p[0] * k, p[1] * k];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
function unit(v) { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; }

// 선/폴리라인을 벽 세그먼트 [[a,b],...] 로
function segments(p) {
  if (p.kind === "line") return [[p.points[0], p.points[1]]];
  if (p.kind === "polyline") {
    const segs = [];
    for (let i = 0; i < p.points.length - 1; i++) segs.push([p.points[i], p.points[i + 1]]);
    if (p.closed && p.points.length > 2) segs.push([p.points[p.points.length - 1], p.points[0]]);
    return segs;
  }
  return [];
}

// 기둥으로 매핑된 primitive의 footprint(도면 단위)를 모은다.
// 반환: [{ center:[x,y], w, d }] — subtractColumns가 벽을 잘라내는 데 사용.
function collectColumnBoxes(primitives, mapping) {
  const boxes = [];
  for (const p of primitives) {
    if ((mapping[p.layer] || "ignore") !== "column") continue;
    const col = columnFrom(p);
    if (col) boxes.push(col);
  }
  return boxes;
}

// 벽 세그먼트(job)에서 기둥과 겹치는 구간을 잘라내 조각들로 나눈다.
// 벽 선이 기둥을 관통해도, 벽 solid가 기둥과 겹치지 않도록 기둥 면에서 끊는다.
// 좌표는 도면 단위(DU). 반환: [{ start, end, layer, paired, thicknessDU }, ...]
function subtractColumns(job, columns, o) {
  const p0 = job.start, p1 = job.end;
  const L = dist(p0, p1);
  if (!columns.length || L < 1e-6) return [job];

  const dir = unit(sub(p1, p0));
  const normal = [-dir[1], dir[0]];         // 벽에 수직인 방향
  const scale = o.scale || 1;
  const thDU = job.paired ? job.thicknessDU : (o.wallThickness / scale);
  const halfT = thDU / 2;

  // 기둥마다 벽 방향으로 덮는 구간 [lo,hi] 수집(수직으로 벽 두께와 겹칠 때만)
  const cuts = [];
  for (const col of columns) {
    const hw = col.w / 2, hd = col.d / 2, c = col.center;
    let tmin = Infinity, tmax = -Infinity, smin = Infinity, smax = -Infinity;
    for (const cx of [-hw, hw]) for (const cy of [-hd, hd]) {
      const v = sub([c[0] + cx, c[1] + cy], p0);
      const t = dot(v, dir), sN = dot(v, normal);
      if (t < tmin) tmin = t; if (t > tmax) tmax = t;
      if (sN < smin) smin = sN; if (sN > smax) smax = sN;
    }
    if (smax < -halfT || smin > halfT) continue;   // 벽 폭 밖의 기둥 → 무시
    const lo = Math.max(0, tmin), hi = Math.min(L, tmax);
    if (hi > lo) cuts.push([lo, hi]);
  }
  if (!cuts.length) return [job];

  // 겹치는 잘라낼 구간들을 병합
  cuts.sort((a, b) => a[0] - b[0]);
  const merged = [cuts[0].slice()];
  for (let i = 1; i < cuts.length; i++) {
    const last = merged[merged.length - 1];
    if (cuts[i][0] <= last[1]) last[1] = Math.max(last[1], cuts[i][1]);
    else merged.push(cuts[i].slice());
  }

  // 잘라낸 구간의 여집합을 벽 조각으로
  const minLen = 10 / scale;                 // 10mm 미만 조각은 버림
  const at = (t) => add(p0, mul(dir, t));
  const pieces = [];
  let cursor = 0;
  for (const [lo, hi] of merged) {
    if (lo - cursor > minLen) pieces.push({ ...job, start: at(cursor), end: at(lo) });
    cursor = Math.max(cursor, hi);
  }
  if (L - cursor > minLen) pieces.push({ ...job, start: at(cursor), end: at(L) });
  return pieces;
}

// ── 문·창(개구부) 감지 & 벽 호스팅 ─────────────────────────────────
// 문·창 레이어의 선들을 근접끼리 묶어 각각을 하나의 박스(개구부)로 본다.
// 반환: [{ center:[x,y], pts:[[x,y]...], w, d }] (도면 단위)
function openingBoxes(primitives, mapping, type, o) {
  const items = [];
  for (const p of primitives) {
    if ((mapping[p.layer] || "ignore") !== type) continue;
    const pts = primPoints(p);
    if (pts.length) items.push({ pts, bbox: bboxOf(pts) });
  }
  if (!items.length) return [];

  // 근접한 원시도형(문틀·문짝 선 등)을 하나의 개구부로 병합 (union-find)
  const scale = o.scale || 1;
  const gap = 300 / scale; // 300mm 이내면 같은 개구부로 본다
  const parent = items.map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (bboxNear(items[i].bbox, items[j].bbox, gap)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });

  const boxes = [];
  for (const grp of groups.values()) {
    const pts = grp.flatMap((g) => g.pts);
    const bb = bboxOf(pts);
    boxes.push({
      center: [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2],
      pts, w: bb.maxX - bb.minX, d: bb.maxY - bb.minY,
    });
  }
  return boxes;
}

// 개구부 박스를 가장 가까운 벽에 호스팅해 문/창 요소를 만든다.
function makeOpening(type, box, walls, o, sp) {
  const isDoor = type === "door";
  const height = isDoor ? o.doorHeight : o.windowHeight;
  const sill = isDoor ? o.doorSill : o.windowSill;

  // 박스를 mm 좌표로
  const center = sp(box.center);
  const pts = box.pts.map(sp);
  const host = nearestWallHost(center, walls);

  let angle, width, thickness, position, elevation, hostId;
  if (host) {
    const dir = host.dir, a = host.wall.start;
    angle = Math.atan2(dir[1], dir[0]);
    // 폭 = 개구부 점들을 벽 방향으로 투영한 스팬
    const proj = pts.map((p) => dot(sub(p, center), dir));
    width = Math.max(...proj) - Math.min(...proj);
    thickness = host.wall.thickness;           // 두께는 호스트 벽에 맞춘다
    // 중심을 벽 중심선 위로 스냅(벽 두께 안에 정확히 박히도록)
    const along = dot(sub(center, a), dir);
    position = add(a, mul(dir, along));
    elevation = host.wall.elevation || 0;
    hostId = host.wall.id;
  } else {
    // 호스트 벽 없음: 박스 자체 크기로(긴 변=폭)
    const s = o.scale || 1;
    width = Math.max(box.w, box.d) * s;
    thickness = Math.min(box.w, box.d) * s;
    angle = box.w >= box.d ? 0 : Math.PI / 2;
    position = center;
    elevation = 0;
    hostId = null;
  }

  const make = isDoor ? createDoor : createWindow;
  return make({
    name: `${isDoor ? "문" : "창"} (${host ? "호스트 " + hostId : "독립"})`,
    hostId, position,
    width: Math.max(1, Math.round(width)),
    thickness: Math.max(1, Math.round(thickness)),
    height, sill, angle, elevation,
  });
}

// 개구부 중심에서 수직거리가 가장 가까운 벽을 찾는다. { wall, dir } | null
function nearestWallHost(center, walls) {
  let best = null, bestD = Infinity;
  for (const w of walls) {
    const ab = sub(w.end, w.start);
    const L = Math.hypot(ab[0], ab[1]);
    if (L < 1e-6) continue;
    const dir = [ab[0] / L, ab[1] / L];
    const t = Math.max(0, Math.min(L, dot(sub(center, w.start), dir)));
    const proj = add(w.start, mul(dir, t));
    const d = dist(center, proj);
    if (d < bestD) { bestD = d; best = { wall: w, dir, perp: d }; }
  }
  return best; // 벽이 없으면 null
}

// 원시도형의 대표 점들(bbox 산정용)
function primPoints(p) {
  if (p.kind === "line" || p.kind === "polyline") return p.points;
  if (p.kind === "circle") {
    return [
      [p.center[0] - p.radius, p.center[1] - p.radius],
      [p.center[0] + p.radius, p.center[1] + p.radius],
    ];
  }
  return [];
}

function bboxOf(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// 두 bbox가 gap 이내로 근접(또는 겹침)하는가
function bboxNear(a, b, gap) {
  return a.minX - gap <= b.maxX && b.minX - gap <= a.maxX &&
         a.minY - gap <= b.maxY && b.minY - gap <= a.maxY;
}

// 기둥 형상 추출: 원 → 외접 사각, 닫힌 폴리라인 → bbox
function columnFrom(p) {
  if (p.kind === "circle") {
    return { center: p.center, w: p.radius * 2, d: p.radius * 2 };
  }
  if (p.kind === "polyline" && p.points.length >= 3) {
    const xs = p.points.map((q) => q[0]), ys = p.points.map((q) => q[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { center: [(minX + maxX) / 2, (minY + maxY) / 2], w: maxX - minX, d: maxY - minY };
  }
  return null;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
