// 매우 단순화한 IFC4 STEP 파일 생성기 (MVP 수준).
// 각 요소를 IfcBuildingElementProxy + 박스 형상으로 내보낸다.
// 실제 IfcWall/IfcSlab 정밀 형상 대신, BIM 협업 도구에서 형상이 보이는 수준을 목표로 한다.

function header(name) {
  const ts = "2026-01-01T00:00:00";
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('BIMelang export'),'2;1');
FILE_NAME('${name}.ifc','${ts}',(''),(''),'BIMelang MVP','BIMelang','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;`;
}

export function exportIFC(model) {
  const name = (model.project?.name || "BIMelang").replace(/[^\w가-힣]+/g, "_");
  const lines = [header(name)];
  let id = 1;
  const ref = () => `#${id++}`;
  const push = (s) => lines.push(`#${id - 1}=${s}`);
  const next = (s) => { const r = ref(); lines.push(`${r}=${s}`); return r; };

  // 기본 단위/컨텍스트 (간략)
  const proj = next(`IFCPROJECT('${guid()}',$,'${model.project?.name || "BIMelang"}',$,$,$,$,$,$);`);

  for (const el of model.elements) {
    const verts = solidVertices(el);
    if (!verts) continue;
    const pts = verts.map((v) => next(`IFCCARTESIANPOINT((${v[0].toFixed(1)},${v[1].toFixed(1)},${v[2].toFixed(1)}));`));
    // 윗면/아랫면을 잇는 6면체를 폐쇄 쉘로 정의
    const faces = boxFaces().map((f) => {
      const loop = next(`IFCPOLYLOOP((${f.map((i) => pts[i]).join(",")}));`);
      const face = next(`IFCFACEOUTERBOUND(${loop},.T.);`);
      return next(`IFCFACE((${face}));`);
    });
    const shell = next(`IFCCLOSEDSHELL((${faces.join(",")}));`);
    const fbsm = next(`IFCFACETEDBREP(${shell});`);
    next(`IFCBUILDINGELEMENTPROXY('${guid()}',$,'${el.name || el.type}','${el.type}',$,$,$,$,$);`);
    // 형상-요소 연결은 MVP에서 생략(브렙만 포함). 뷰어에서 형상 확인용.
  }

  lines.push("ENDSEC;", "END-ISO-10303-21;");
  return lines.join("\n");
}

// 8개 꼭짓점 (0..3 아랫면, 4..7 윗면)
function solidVertices(el) {
  if (el.type === "wall") {
    const [x1, y1] = el.start, [x2, y2] = el.end;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (el.thickness / 2);
    const ny = (dx / len) * (el.thickness / 2);
    const z0 = el.elevation || 0, z1 = z0 + el.height;
    const a = [x1 + nx, y1 + ny], b = [x2 + nx, y2 + ny];
    const c = [x2 - nx, y2 - ny], d = [x1 - nx, y1 - ny];
    return [
      [a[0], a[1], z0], [b[0], b[1], z0], [c[0], c[1], z0], [d[0], d[1], z0],
      [a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1], [d[0], d[1], z1],
    ];
  }
  if (el.type === "slab") {
    // 슬래브는 폴리곤 bbox 기반 박스로 단순화
    const xs = el.polygon.map((p) => p[0]), ys = el.polygon.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const z0 = el.elevation || 0, z1 = z0 + el.thickness;
    return [
      [minX, minY, z0], [maxX, minY, z0], [maxX, maxY, z0], [minX, maxY, z0],
      [minX, minY, z1], [maxX, minY, z1], [maxX, maxY, z1], [minX, maxY, z1],
    ];
  }
  return null;
}

function boxFaces() {
  return [
    [0, 1, 2, 3], // bottom
    [4, 7, 6, 5], // top
    [0, 4, 5, 1], // sides
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ];
}

// IFC GlobalId: 22자 base64 (간이 생성)
function guid() {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let s = "";
  for (let i = 0; i < 22; i++) s += chars[Math.floor(((i * 9301 + 49297) % 233280) / 233280 * 64) % 64];
  return s;
}
