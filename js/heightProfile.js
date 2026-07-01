// 단면도·입면도(2D DXF)에서 높이 정보를 추출한다.
// 도면은 "높이 = Y축(수직)"으로 그려졌다고 가정한다(단면도·입면도 표준).
// 수평선(일정한 Y값의 선)들을 층 레벨(level)로 인식하고,
// 최하단=바닥(0), 최상단 수평선=지붕, 그 사이=중간 층 바닥으로 본다.
//
// 반환 profile (단위: mm, base=0 기준):
//   { base:0, levels:[0, 3000, 6000], roof:6000, top:6600,
//     floorHeight:3000, totalHeight:6600 }
//   - levels: 감지된 층 레벨 높이(오름차순, 항상 0 포함)
//   - roof:   최상단 수평선 높이(지붕 바닥 높이)
//   - top:    도면 전체 최고점(경사지붕 용마루 등)
//   - floorHeight: 연속 레벨 간격의 중앙값(대표 층고)

export function extractHeightProfile(primitives, scale = 1) {
  const segs = [];
  let minY = Infinity, maxY = -Infinity;
  for (const p of primitives) {
    for (const [a, b] of segsOf(p)) {
      segs.push([a, b]);
      minY = Math.min(minY, a[1], b[1]);
      maxY = Math.max(maxY, a[1], b[1]);
    }
    if (p.kind === "circle") {
      minY = Math.min(minY, p.center[1] - p.radius);
      maxY = Math.max(maxY, p.center[1] + p.radius);
    }
  }
  if (!isFinite(minY) || !isFinite(maxY) || maxY - minY < 1e-6) return null;

  // 수평 세그먼트(거의 일정한 Y)의 Y값을 길이 가중치와 함께 모은다.
  const hits = [];
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    if (Math.abs(dy) <= Math.max(1e-6, 0.02 * len)) {
      hits.push({ y: (a[1] + b[1]) / 2, len });
    }
  }

  // Y값을 tolerance(≈200mm) 이내로 클러스터링(길이 가중 평균).
  const tol = 200 / (scale || 1);
  hits.sort((p, q) => p.y - q.y);
  const clusters = [];
  for (const h of hits) {
    const c = clusters[clusters.length - 1];
    if (c && h.y - c.y <= tol) {
      const w = c.len + h.len;
      c.y = (c.y * c.len + h.y * h.len) / w;
      c.len = w;
    } else {
      clusters.push({ y: h.y, len: h.len });
    }
  }

  // 잡선 제거: 가장 긴 수평선 길이의 15% 이상인 레벨만 채택.
  const maxLen = clusters.reduce((m, c) => Math.max(m, c.len), 0) || 1;
  let raw = clusters.filter((c) => c.len >= 0.15 * maxLen).map((c) => c.y);
  if (!raw.length) raw = [minY, maxY];

  // base=최하단을 0으로, mm 단위로 정규화.
  const base = minY;
  const toMM = (y) => Math.round((y - base) * (scale || 1));
  let levels = [...new Set(raw.map(toMM))].sort((a, b) => a - b);
  if (levels[0] !== 0) levels = [0, ...levels];

  const top = Math.round((maxY - base) * (scale || 1));
  const roof = levels[levels.length - 1];
  const gaps = [];
  for (let i = 1; i < levels.length; i++) gaps.push(levels[i] - levels[i - 1]);
  const floorHeight = gaps.length ? median(gaps) : top;

  return { base: 0, levels, roof, top, floorHeight, totalHeight: top };
}

// 선/폴리라인을 세그먼트 [[a,b],...] 로 (circle 제외)
function segsOf(p) {
  if (p.kind === "line") return [[p.points[0], p.points[1]]];
  if (p.kind === "polyline") {
    const out = [];
    for (let i = 0; i < p.points.length - 1; i++) out.push([p.points[i], p.points[i + 1]]);
    if (p.closed && p.points.length > 2) out.push([p.points[p.points.length - 1], p.points[0]]);
    return out;
  }
  return [];
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
