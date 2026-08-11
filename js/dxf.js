// 최소 DXF 파서 (MVP). ASCII DXF에서
// LINE / LWPOLYLINE / POLYLINE+VERTEX / CIRCLE / ARC / INSERT(블록) 를 추출한다.
// 반환: { primitives: [...], layers: {name: count}, insunits: number|null }
//
// primitive 형태:
//  { kind:'line',     layer, points:[[x,y],[x,y]] }
//  { kind:'polyline', layer, points:[[x,y]...], closed }
//  { kind:'circle',   layer, center:[x,y], radius }
//
// 문·창·기둥은 실제 도면에서 대부분 블록(INSERT)이나 호(ARC)로 그려지므로,
// BLOCKS 섹션의 블록 정의를 읽어 INSERT를 실제 도형으로 펼치고(스케일·회전·이동 반영),
// ARC는 폴리라인(샘플 점)으로 변환한다.

const num = (v) => parseFloat(v);

export function parseDXF(text) {
  const raw = text.split(/\r\n|\r|\n/);
  // (코드, 값) 페어로 묶기
  const pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const code = parseInt(raw[i].trim(), 10);
    if (Number.isNaN(code)) { i--; continue; } // 정렬 깨짐 방어
    pairs.push({ code, value: (raw[i + 1] ?? "").trim() });
  }

  // 헤더에서 $INSUNITS 읽기 (단위: 1=in, 4=mm, 5=cm, 6=m)
  let insunits = null;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i].code === 9 && pairs[i].value === "$INSUNITS") {
      insunits = parseInt(pairs[i + 1].value, 10);
      break;
    }
  }

  // 지정한 이름의 섹션 [start,end) 범위(코드 페어 인덱스). 없으면 null.
  const sectionRange = (name) => {
    let s = -1;
    for (let i = 0; i < pairs.length - 1; i++) {
      if (pairs[i].code === 0 && pairs[i].value === "SECTION" &&
          pairs[i + 1].code === 2 && pairs[i + 1].value === name) { s = i + 2; break; }
    }
    if (s < 0) return null;
    let e = s;
    for (; e < pairs.length; e++) if (pairs[e].code === 0 && pairs[e].value === "ENDSEC") break;
    return [s, e];
  };

  // [start,end) 범위의 페어를 엔티티 단위(코드 0 경계)로 묶는다.
  const groupEntities = (range) => {
    const ents = [];
    if (!range) return ents;
    let cur = null;
    for (let i = range[0]; i < range[1]; i++) {
      const { code, value } = pairs[i];
      if (code === 0) {
        if (value === "ENDSEC" || value === "EOF") break;
        cur = { type: value, codes: [] };
        ents.push(cur);
      } else if (cur) {
        cur.codes.push({ code, value });
      }
    }
    return ents;
  };

  // BLOCKS 섹션: 블록 이름 → { base:[x,y], ents:[...] }
  const blocks = {};
  {
    const bents = groupEntities(sectionRange("BLOCKS"));
    for (let i = 0; i < bents.length; i++) {
      if (bents[i].type !== "BLOCK") continue;
      const g = (c) => bents[i].codes.find((x) => x.code === c)?.value;
      const name = g(2) || "";
      const base = [num(g(10)) || 0, num(g(20)) || 0];
      const inner = [];
      let j = i + 1;
      for (; j < bents.length && bents[j].type !== "ENDBLK"; j++) inner.push(bents[j]);
      if (name) blocks[name] = { base, ents: inner };
      i = j; // ENDBLK 로 점프
    }
  }

  const primitives = [];
  const layers = {};
  const note = (layer) => { layers[layer] = (layers[layer] || 0) + 1; };
  const layerOf = (codes) => (codes.find((c) => c.code === 8)?.value) || "0";

  // 엔티티 목록 → primitives. tf: 점 변환(월드 좌표), layerCtx: 상위(INSERT) 레이어, depth: 재귀 깊이.
  const emit = (ents, tf, layerCtx, depth) => {
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      const g = (c) => e.codes.find((x) => x.code === c)?.value;
      let layer = layerOf(e.codes);
      if ((layer === "0" || layer === "") && layerCtx) layer = layerCtx; // 블록 내부 레이어0 → INSERT 레이어

      if (e.type === "LINE") {
        const p = [tf([num(g(10)), num(g(20))]), tf([num(g(11)), num(g(21))])];
        if (valid(p[0]) && valid(p[1])) { primitives.push({ kind: "line", layer, points: p }); note(layer); }

      } else if (e.type === "CIRCLE") {
        const center = tf([num(g(10)), num(g(20))]);
        const radius = num(g(40));
        if (valid(center) && radius > 0) { primitives.push({ kind: "circle", layer, center, radius }); note(layer); }

      } else if (e.type === "ARC") {
        const c = [num(g(10)), num(g(20))], r = num(g(40));
        const pts = valid(c) && r > 0 ? sampleArc(c, r, num(g(50)) || 0, num(g(51)) || 0).map(tf) : [];
        if (pts.length >= 2) { primitives.push({ kind: "polyline", layer, points: pts, closed: false }); note(layer); }

      } else if (e.type === "LWPOLYLINE") {
        // 정점을 bulge(볼록값)와 함께 모은 뒤, bulge>0 구간은 호로 분해한다.
        const verts = [];
        let x = null, closed = false;
        for (const c of e.codes) {
          if (c.code === 70) closed = (parseInt(c.value, 10) & 1) === 1;
          else if (c.code === 10) x = num(c.value);
          else if (c.code === 20 && x !== null) { verts.push({ x, y: num(c.value), bulge: 0 }); x = null; }
          else if (c.code === 42 && verts.length) verts[verts.length - 1].bulge = num(c.value);
        }
        const pts = polylineFromVerts(verts, closed).map(tf);
        if (pts.length >= 2) { primitives.push({ kind: "polyline", layer, points: pts, closed }); note(layer); }

      } else if (e.type === "POLYLINE") {
        // 구형 POLYLINE: 뒤따르는 VERTEX 들을 SEQEND 까지 수집 (bulge 포함)
        let closed = false;
        const flag = e.codes.find((c) => c.code === 70);
        if (flag) closed = (parseInt(flag.value, 10) & 1) === 1;
        const verts = [];
        let j = k + 1;
        for (; j < ents.length && ents[j].type === "VERTEX"; j++) {
          const gg = (c) => ents[j].codes.find((x) => x.code === c)?.value;
          const pt = [num(gg(10)), num(gg(20))];
          if (valid(pt)) verts.push({ x: pt[0], y: pt[1], bulge: num(gg(42)) || 0 });
        }
        k = j - 1; // VERTEX 만큼 건너뛰기 (SEQEND 는 다음 루프에서 무시)
        const pts = polylineFromVerts(verts, closed).map(tf);
        if (pts.length >= 2) { primitives.push({ kind: "polyline", layer, points: pts, closed }); note(layer); }

      } else if (e.type === "INSERT") {
        // 블록 참조: 블록 정의를 스케일·회전·이동 반영해 펼친다.
        if (depth > 4) continue;
        const blk = blocks[g(2)];
        if (!blk) continue;
        const ins = [num(g(10)) || 0, num(g(20)) || 0];
        const sx = num(g(41)), sy = num(g(42));
        const scaleX = Number.isFinite(sx) && sx !== 0 ? sx : 1;
        const scaleY = Number.isFinite(sy) && sy !== 0 ? sy : 1;
        const rot = (num(g(50)) || 0) * Math.PI / 180, cos = Math.cos(rot), sin = Math.sin(rot);
        const [bx, by] = blk.base;
        // 블록좌표 p → (p-base)*scale → 회전 → +insertion → 상위 tf
        const bt = (p) => {
          const lx = (p[0] - bx) * scaleX, ly = (p[1] - by) * scaleY;
          return tf([ins[0] + lx * cos - ly * sin, ins[1] + lx * sin + ly * cos]);
        };
        emit(blk.ents, bt, (layer === "0" || layer === "") ? layerCtx : layer, depth + 1);
      }
    }
  };

  emit(groupEntities(sectionRange("ENTITIES")), (p) => p, null, 0);
  return { primitives, layers, insunits };
}

// (bulge 포함) 정점 목록 → 실제 점열. bulge>0 세그먼트는 호로 분해한다.
function polylineFromVerts(verts, closed) {
  const pts = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const v = verts[i];
    pts.push([v.x, v.y]);
    const nx = i + 1 < n ? verts[i + 1] : (closed ? verts[0] : null);
    if (nx && Math.abs(v.bulge) > 1e-6) {
      for (const q of tessellateBulge([v.x, v.y], [nx.x, nx.y], v.bulge)) pts.push(q);
    }
  }
  return pts;
}

// bulge(=tan(θ/4))로 정의된 두 정점 사이 호를 중간 점들로 분해(양 끝점 제외).
function tessellateBulge(p1, p2, bulge) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-9 || Math.abs(bulge) < 1e-6) return [];
  const px = -dy / L, py = dx / L;               // 좌측 수직 단위
  const sag = (L / 2) * bulge;                   // 부호 있는 새기타(호 정점 편차)
  const apex = [(p1[0] + p2[0]) / 2 + px * sag, (p1[1] + p2[1]) / 2 + py * sag];
  const c = circumcenter(p1, apex, p2);
  if (!c) return [];
  const R = Math.hypot(p1[0] - c[0], p1[1] - c[1]);
  const a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  const a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
  const aA = Math.atan2(apex[1] - c[1], apex[0] - c[0]);
  const norm = (a) => { while (a <= -Math.PI) a += 2 * Math.PI; while (a > Math.PI) a -= 2 * Math.PI; return a; };
  const toApex = norm(aA - a0);
  let sweep = norm(a2 - a0);
  if (toApex >= 0 && sweep < 0) sweep += 2 * Math.PI;   // 호 정점을 지나는 방향으로 스윕
  if (toApex < 0 && sweep > 0) sweep -= 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 12))); // ~15° 간격
  const out = [];
  for (let i = 1; i < n; i++) {
    const a = a0 + sweep * (i / n);
    out.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]);
  }
  return out;
}

// 세 점의 외심(원주 중심). 공선이면 null.
function circumcenter(A, B, C) {
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = A[0] * A[0] + A[1] * A[1], b2 = B[0] * B[0] + B[1] * B[1], c2 = C[0] * C[0] + C[1] * C[1];
  return [
    (a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d,
    (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d,
  ];
}

// 호(ARC)를 점들로 샘플링 (~22.5° 간격). a0,a1: 시작·끝 각(도).
function sampleArc(c, r, a0deg, a1deg) {
  let a0 = a0deg * Math.PI / 180, a1 = a1deg * Math.PI / 180;
  if (a1 <= a0) a1 += 2 * Math.PI;
  const n = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 8)));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return pts;
}

function valid(p) {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

// $INSUNITS → mm 배율
export function unitsToScale(insunits) {
  switch (insunits) {
    case 1: return 25.4;   // inch
    case 4: return 1;      // mm
    case 5: return 10;     // cm
    case 6: return 1000;   // m
    case 2: return 304.8;  // ft
    default: return 1;     // 미지정 → mm 가정
  }
}
