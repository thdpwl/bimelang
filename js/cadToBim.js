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
    wallThickness: 200,
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

  for (const p of primitives) {
    const t = mapping[p.layer] || "ignore";
    if (t === "ignore") continue;

    if (t === "wall") {
      for (const [a, b] of segments(p)) {
        if (dist(a, b) < 1) continue;
        out.push(createWall({
          name: `벽 (${p.layer})`,
          start: sp(a), end: sp(b),
          height: o.wallHeight, thickness: o.wallThickness, elevation: 0,
        }));
      }
    } else if (t === "column") {
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
export function preview(primitives, mapping) {
  const c = { wall: 0, column: 0, slab: 0, roof: 0 };
  for (const p of primitives) {
    const t = mapping[p.layer] || "ignore";
    if (t === "wall") c.wall += segments(p).length;
    else if (t === "column") { if (columnFrom(p)) c.column++; }
    else if (t === "slab") { if (p.kind === "polyline" && p.points.length >= 3) c.slab++; }
    else if (t === "roof") { if (p.kind === "polyline" && p.points.length >= 3) c.roof++; }
  }
  return c;
}

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
