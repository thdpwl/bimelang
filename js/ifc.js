// IFC4 STEP 파일 생성기.
// Revit 등 BIM 저작도구에서 임포트 가능한 수준의 유효한 IFC를 만든다.
// 각 요소를 실제 IFC 타입(IfcWall/IfcSlab/IfcColumn)으로 내보내고,
// 압출 솔리드(IfcExtrudedAreaSolid) 형상을 요소에 연결한다.
// 좌표 단위는 mm (모델과 동일) → IfcUnitAssignment에서 MILLI METRE로 선언.

function header(name) {
  const ts = "2026-01-01T00:00:00";
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('${name}.ifc','${ts}',(''),(''),'BIMelang MVP','BIMelang','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;`;
}

// STEP REAL: 반드시 소수점을 포함해야 한다 (5000 -> "5000.").
function num(v) {
  if (!isFinite(v)) v = 0;
  return Number.isInteger(v) ? `${v}.` : `${v}`;
}

export function exportIFC(model) {
  const projName = model.project?.name || "BIMelang";
  const fileName = projName.replace(/[^\w가-힣]+/g, "_");
  const lines = [header(esc(fileName))];

  let id = 0;
  // 엔티티를 추가하고 참조(#n)를 돌려준다.
  const add = (s) => { const r = `#${++id}`; lines.push(`${r}=${s}`); return r; };

  // 유일 GlobalId 생성기 (요소마다 서로 다른 22자 IFC base64).
  let gseq = 0;
  const gid = () => guid(++gseq);

  // --- 소유 이력 (OwnerHistory) ---
  const person = add(`IFCPERSON($,$,'BIMelang',$,$,$,$,$);`);
  const org = add(`IFCORGANIZATION($,'BIMelang',$,$,$);`);
  const pao = add(`IFCPERSONANDORGANIZATION(${person},${org},$);`);
  const app = add(`IFCAPPLICATION(${org},'1.0','BIMelang','BIMelang');`);
  const owner = add(`IFCOWNERHISTORY(${pao},${app},$,.ADDED.,$,$,$,0);`);

  // --- 단위 (mm 기반) ---
  const uLen = add(`IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);`);
  const uArea = add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);`);
  const uVol = add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);`);
  const uAng = add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);`);
  const units = add(`IFCUNITASSIGNMENT((${uLen},${uArea},${uVol},${uAng}));`);

  // --- 형상 표현 컨텍스트 ---
  const originPt = add(`IFCCARTESIANPOINT((0.,0.,0.));`);
  const worldAxis = add(`IFCAXIS2PLACEMENT3D(${originPt},$,$);`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${worldAxis},$);`);

  // --- 프로젝트 ---
  const project = add(`IFCPROJECT('${gid()}',${owner},'${esc(projName)}',$,$,$,$,(${ctx}),${units});`);

  // --- 공간 구조: Site -> Building -> Storey ---
  const sitePl = add(`IFCLOCALPLACEMENT($,${worldAxis});`);
  const site = add(`IFCSITE('${gid()}',${owner},'${esc("대지")}',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$);`);
  const bldgPl = add(`IFCLOCALPLACEMENT(${sitePl},${worldAxis});`);
  const building = add(`IFCBUILDING('${gid()}',${owner},'${esc("건물")}',$,$,${bldgPl},$,$,.ELEMENT.,$,$,$);`);
  const storeyPl = add(`IFCLOCALPLACEMENT(${bldgPl},${worldAxis});`);
  const storey = add(`IFCBUILDINGSTOREY('${gid()}',${owner},'${esc("1층")}',$,$,${storeyPl},$,$,.ELEMENT.,0.);`);

  // 집합 관계
  add(`IFCRELAGGREGATES('${gid()}',${owner},$,$,${project},(${site}));`);
  add(`IFCRELAGGREGATES('${gid()}',${owner},$,$,${site},(${building}));`);
  add(`IFCRELAGGREGATES('${gid()}',${owner},$,$,${building},(${storey}));`);

  // --- 요소 ---
  const productRefs = [];
  for (const el of model.elements) {
    const fp = footprint(el);
    if (!fp) continue;

    // 2D 프로파일 (닫힌 폴리라인)
    const pts = fp.pts.map((p) => add(`IFCCARTESIANPOINT((${num(p[0])},${num(p[1])}));`));
    const loopPts = [...pts, pts[0]]; // 폐합
    const polyline = add(`IFCPOLYLINE((${loopPts.join(",")}));`);
    const profile = add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${polyline});`);

    // 압출 위치 (Z = 바닥 높이), +Z 방향으로 depth 만큼 압출
    const basePt = add(`IFCCARTESIANPOINT((0.,0.,${num(fp.z0)}));`);
    const baseAxis = add(`IFCAXIS2PLACEMENT3D(${basePt},$,$);`);
    const extrudeDir = add(`IFCDIRECTION((0.,0.,1.));`);
    const solid = add(`IFCEXTRUDEDAREASOLID(${profile},${baseAxis},${extrudeDir},${num(fp.depth)});`);

    const shapeRep = add(`IFCSHAPEREPRESENTATION(${ctx},'Body','SweptSolid',(${solid}));`);
    const prodShape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shapeRep}));`);

    // 요소 배치 (층에 상대적, 항등 변환 — 좌표는 형상에 반영됨)
    const elPl = add(`IFCLOCALPLACEMENT(${storeyPl},${worldAxis});`);

    const nm = esc(el.name || el.type);
    const tag = esc(el.id || "");
    const g = gid();
    let ref;
    if (el.type === "wall") {
      ref = add(`IFCWALL('${g}',${owner},'${nm}',$,$,${elPl},${prodShape},'${tag}',.STANDARD.);`);
    } else if (el.type === "slab") {
      ref = add(`IFCSLAB('${g}',${owner},'${nm}',$,$,${elPl},${prodShape},'${tag}',.FLOOR.);`);
    } else if (el.type === "column") {
      ref = add(`IFCCOLUMN('${g}',${owner},'${nm}',$,$,${elPl},${prodShape},'${tag}',.COLUMN.);`);
    } else {
      ref = add(`IFCBUILDINGELEMENTPROXY('${g}',${owner},'${nm}',$,$,${elPl},${prodShape},'${tag}',$);`);
    }
    productRefs.push(ref);
  }

  // 요소를 층에 공간적으로 포함
  if (productRefs.length) {
    add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${gid()}',${owner},$,$,(${productRefs.join(",")}),${storey});`);
  }

  lines.push("ENDSEC;", "END-ISO-10303-21;");
  return lines.join("\n");
}

// STEP 문자열 이스케이프.
// - 작은따옴표는 두 개로, 역슬래시도 두 개로.
// - 비ASCII(한글 등)는 ISO-10303-21 \X2\....\X0\ (UTF-16 4자리 hex) 로 인코딩.
function esc(s) {
  let out = "";
  let unicode = ""; // 연속된 비ASCII를 하나의 \X2\ 블록으로 모은다.
  const flush = () => { if (unicode) { out += `\\X2\\${unicode}\\X0\\`; unicode = ""; } };
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (code < 128) {
      flush();
      if (ch === "'") out += "''";
      else if (ch === "\\") out += "\\\\";
      else out += ch;
    } else {
      // 서로게이트 쌍 포함 UTF-16 코드유닛으로 변환
      for (let i = 0; i < ch.length; i++) {
        unicode += ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
      }
    }
  }
  flush();
  return out;
}

// 요소별 2D 발자국(footprint) + 바닥높이(z0) + 압출깊이(depth).
// 모든 요소를 "XY 평면의 닫힌 다각형을 +Z로 압출"하는 방식으로 통일.
function footprint(el) {
  if (el.type === "wall") {
    const [x1, y1] = el.start, [x2, y2] = el.end;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (el.thickness / 2);
    const ny = (dx / len) * (el.thickness / 2);
    return {
      pts: [
        [x1 + nx, y1 + ny],
        [x2 + nx, y2 + ny],
        [x2 - nx, y2 - ny],
        [x1 - nx, y1 - ny],
      ],
      z0: el.elevation || 0,
      depth: el.height,
    };
  }
  if (el.type === "slab") {
    return {
      pts: el.polygon.map((p) => [p[0], p[1]]),
      z0: el.elevation || 0,
      depth: el.thickness,
    };
  }
  if (el.type === "column") {
    const [cx, cy] = el.position;
    const hw = el.width / 2, hd = el.depth / 2;
    return {
      pts: [
        [cx - hw, cy - hd],
        [cx + hw, cy - hd],
        [cx + hw, cy + hd],
        [cx - hw, cy + hd],
      ],
      z0: el.elevation || 0,
      depth: el.height,
    };
  }
  return null;
}

// IFC GlobalId: 128비트를 22자 IFC base64로 인코딩.
// seq(요소 순번)로 서로 다른 유일 값을 생성한다.
function guid(seq) {
  // seq와 시간-무관 상수로 16바이트를 채운다 (재현 가능하되 요소마다 유일).
  const bytes = new Array(16);
  let x = (seq * 2654435761) >>> 0; // Knuth 곱셈 해시
  for (let i = 0; i < 16; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    bytes[i] = (x >>> 16) & 0xff;
  }
  bytes[0] = (seq >>> 8) & 0xff;
  bytes[1] = seq & 0xff;
  return ifcBase64(bytes);
}

// 16바이트 -> 22자 IFC base64 (IFC 전용 알파벳, 1+5*3 바이트 그룹핑).
function ifcBase64(bytes) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  // 첫 바이트 -> 2글자, 이후 3바이트씩 5그룹 -> 각 4글자 = 2 + 20 = 22글자.
  let str = chars[Math.floor(bytes[0] / 64) % 64] + chars[bytes[0] % 64];
  for (let i = 1; i < 16; i += 3) {
    const n = bytes[i] * 65536 + bytes[i + 1] * 256 + bytes[i + 2];
    str += chars[Math.floor(n / 262144) % 64]
      + chars[Math.floor(n / 4096) % 64]
      + chars[Math.floor(n / 64) % 64]
      + chars[n % 64];
  }
  return str;
}
