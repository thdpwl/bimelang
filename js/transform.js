// 변형(이동·크기·회전) 계산 — three 객체에 의존하지 않는 순수 함수.
// 좌표 단위는 mm. three 표시 배율 S(=0.001)는 호출부와 동일하게 사용한다.
export const S = 0.001;

// 방향 정의: 모델 +x = 동(E), 모델 +y = 북(N). three에서는 x→x, y→z.
export const DIRECTIONS = {
  ArrowUp: [0, 1, 0], // 북
  ArrowDown: [0, -1, 0], // 남
  ArrowRight: [1, 0, 0], // 동
  ArrowLeft: [-1, 0, 0], // 서
  PageUp: [0, 0, 1], // 상승(EL+)
  PageDown: [0, 0, -1], // 하강(EL-)
};

// 요소를 (dx,dy,dz) mm 만큼 평행이동
export function translateElement(el, dx, dy, dz) {
  if (el.type === "wall") {
    el.start = [el.start[0] + dx, el.start[1] + dy];
    el.end = [el.end[0] + dx, el.end[1] + dy];
    el.elevation = (el.elevation || 0) + dz;
  } else if (el.type === "slab") {
    el.polygon = el.polygon.map(([x, y]) => [x + dx, y + dy]);
    el.elevation = (el.elevation || 0) + dz;
  } else if (el.type === "column") {
    el.position = [el.position[0] + dx, el.position[1] + dy];
    el.elevation = (el.elevation || 0) + dz;
  }
  return el;
}

// 기즈모 변형 → 기둥 파라미터 (회전은 MVP에서 미적용)
export function decomposeColumn({ pos, scale, geomParams }) {
  const w = (geomParams.width * scale.x) / S;
  const h = (geomParams.height * scale.y) / S;
  const d = (geomParams.depth * scale.z) / S;
  return {
    position: [pos.x / S, pos.z / S],
    width: w, depth: d, height: h,
    elevation: pos.y / S - h / 2,
  };
}

// 기즈모 변형(position/scale/rotationY) → 벽 파라미터
export function decomposeWall({ pos, scale, rotY, geomParams }) {
  const lenMM = (geomParams.width * scale.x) / S;
  const hMM = (geomParams.height * scale.y) / S;
  const tMM = (geomParams.depth * scale.z) / S;
  const cx = pos.x / S;
  const cy = pos.z / S;
  const elevation = pos.y / S - hMM / 2;
  const theta = -rotY; // 빌드 시 rotY = -atan2(dy,dx)
  const hx = (Math.cos(theta) * lenMM) / 2;
  const hy = (Math.sin(theta) * lenMM) / 2;
  return {
    start: [cx - hx, cy - hy],
    end: [cx + hx, cy + hy],
    height: hMM,
    thickness: tMM,
    elevation,
  };
}

// 기즈모 변형 → 슬래브 폴리곤
// localMM: 중심 기준 로컬 좌표 배열(mm), baseThickness: 빌드 시 두께(mm)
export function decomposeSlab({ pos, scale, rotY, localMM, baseThickness }) {
  const cx = pos.x / S;
  const cy = pos.z / S;
  const elevation = pos.y / S;
  const thickness = baseThickness * scale.y;
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const polygon = localMM.map(([lx, ly]) => {
    const sx = lx * scale.x;
    const sy = ly * scale.z;
    // three Y축 회전: x' = x·cos + z·sin, z' = -x·sin + z·cos
    const nx = sx * cos + sy * sin;
    const ny = -sx * sin + sy * cos;
    return [cx + nx, cy + ny];
  });
  return { polygon, thickness, elevation };
}

// 슬래브 중심/로컬좌표
export function slabCentroid(polygon) {
  const n = polygon.length;
  const cx = polygon.reduce((s, p) => s + p[0], 0) / n;
  const cy = polygon.reduce((s, p) => s + p[1], 0) / n;
  return [cx, cy];
}
