// 최소 DXF 파서 (MVP). ASCII DXF의 ENTITIES 섹션에서
// LINE / LWPOLYLINE / POLYLINE+VERTEX / CIRCLE 를 추출한다.
// 반환: { primitives: [...], layers: {name: count}, insunits: number|null }
//
// primitive 형태:
//  { kind:'line',     layer, points:[[x,y],[x,y]] }
//  { kind:'polyline', layer, points:[[x,y]...], closed }
//  { kind:'circle',   layer, center:[x,y], radius }

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

  // ENTITIES 섹션으로 이동
  let i = 0;
  while (i < pairs.length && !(pairs[i].code === 2 && pairs[i].value === "ENTITIES")) i++;
  i++;

  // 엔티티 단위로 코드 묶기
  const ents = [];
  let cur = null;
  for (; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    if (code === 0) {
      if (cur) ents.push(cur);
      if (value === "ENDSEC" || value === "EOF") { cur = null; break; }
      cur = { type: value, codes: [] };
    } else if (cur) {
      cur.codes.push({ code, value });
    }
  }

  const primitives = [];
  const layers = {};
  const note = (layer) => { layers[layer] = (layers[layer] || 0) + 1; };
  const layerOf = (codes) => (codes.find((c) => c.code === 8)?.value) || "0";

  for (let k = 0; k < ents.length; k++) {
    const e = ents[k];
    const layer = layerOf(e.codes);

    if (e.type === "LINE") {
      const g = (c) => e.codes.find((x) => x.code === c)?.value;
      const p = [[num(g(10)), num(g(20))], [num(g(11)), num(g(21))]];
      if (valid(p[0]) && valid(p[1])) { primitives.push({ kind: "line", layer, points: p }); note(layer); }

    } else if (e.type === "CIRCLE") {
      const g = (c) => e.codes.find((x) => x.code === c)?.value;
      const center = [num(g(10)), num(g(20))];
      const radius = num(g(40));
      if (valid(center) && radius > 0) { primitives.push({ kind: "circle", layer, center, radius }); note(layer); }

    } else if (e.type === "LWPOLYLINE") {
      const pts = [];
      let x = null;
      let closed = false;
      for (const c of e.codes) {
        if (c.code === 70) closed = (parseInt(c.value, 10) & 1) === 1;
        else if (c.code === 10) x = num(c.value);
        else if (c.code === 20 && x !== null) { pts.push([x, num(c.value)]); x = null; }
      }
      if (pts.length >= 2) { primitives.push({ kind: "polyline", layer, points: pts, closed }); note(layer); }

    } else if (e.type === "POLYLINE") {
      // 구형 POLYLINE: 뒤따르는 VERTEX 들을 SEQEND 까지 수집
      let closed = false;
      const flag = e.codes.find((c) => c.code === 70);
      if (flag) closed = (parseInt(flag.value, 10) & 1) === 1;
      const pts = [];
      let j = k + 1;
      for (; j < ents.length && ents[j].type === "VERTEX"; j++) {
        const g = (c) => ents[j].codes.find((x) => x.code === c)?.value;
        const pt = [num(g(10)), num(g(20))];
        if (valid(pt)) pts.push(pt);
      }
      k = j - 1; // VERTEX 만큼 건너뛰기 (SEQEND 는 다음 루프에서 무시)
      if (pts.length >= 2) { primitives.push({ kind: "polyline", layer, points: pts, closed }); note(layer); }
    }
  }

  return { primitives, layers, insunits };
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
