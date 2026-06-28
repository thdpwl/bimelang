// CAD(파싱된 primitive) → BIM 요소 변환.
// 레이어별 매핑(mapping)과 변환 옵션(options)을 받아 model.elements 배열을 만든다.
import { createWall, createSlab, createColumn } from "./model.js";

export const TYPES = ["wall", "column", "slab", "roof", "ignore"];
export const TYPE_LABEL = { wall: "벽", column: "기둥", slab: "바닥(슬래브)", roof: "지붕", ignore: "무시" };

// 레이어 이름으로 객체 타입 자동 추정
export function guessType(layer) {
  const n = layer.toLowerCase();
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
    slabThickness: 250,
    roofThickness: 250,
    roofElevation: 3000,
  };
}

export function convert(primitives, mapping, options) {
  const o = options;
  const s = o.scale;
  const sp = ([x, y]) => [x * s, y * s];
  const out = [];

  // 벽: 전체 선을 모아 평행 2선 → 두께 있는 벽 1개로 병합 후 생성
  for (const job of buildWallJobs(primitives, mapping, o)) {
    out.push(createWall({
      name: `벽 (${job.layer})`,
      start: sp(job.start), end: sp(job.end),
      height: o.wallHeight,
      // 짝지어진 벽은 도면에서 측정한 두께, 단일선은 기본 두께
      thickness: job.paired ? Math.max(1, Math.round(job.thicknessDU * s)) : o.wallThickness,
      elevation: 0,
    }));
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
  return out;
}

// 변환 결과 요약 (미리보기용)
export function preview(primitives, mapping, options) {
  const o = options || defaultOptions();
  const c = { wall: 0, column: 0, slab: 0, roof: 0 };
  c.wall = buildWallJobs(primitives, mapping, o).length;
  for (const p of primitives) {
    const t = mapping[p.layer] || "ignore";
    if (t === "column") { if (columnFrom(p)) c.column++; }
    else if (t === "slab") { if (p.kind === "polyline" && p.points.length >= 3) c.slab++; }
    else if (t === "roof") { if (p.kind === "polyline" && p.points.length >= 3) c.roof++; }
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
