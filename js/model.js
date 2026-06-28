// BIMelang 데이터 모델
// 건축 설계를 단순 JSON으로 표현한다. 좌표 단위는 mm.
//
// element 공통: { id, type, name }
//  - wall:  { start:[x,y], end:[x,y], height, thickness, elevation }
//  - slab:  { polygon:[[x,y],...], thickness, elevation }

let _seq = 1;
export function nextId(prefix = "e") {
  return `${prefix}${_seq++}`;
}

// 외부에서 불러온 모델의 id 충돌을 막기 위해 seq 동기화
export function syncSeq(model) {
  let max = 0;
  for (const el of model.elements || []) {
    const m = /(\d+)$/.exec(el.id || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  _seq = max + 1;
}

export function emptyModel() {
  return {
    project: { name: "새 프로젝트", units: "mm" },
    elements: [],
  };
}

export function createWall(over = {}) {
  return {
    id: nextId("w"),
    type: "wall",
    name: "벽",
    start: [0, 0],
    end: [5000, 0],
    height: 3000,
    thickness: 200,
    elevation: 0,
    ...over,
  };
}

export function createSlab(over = {}) {
  return {
    id: nextId("s"),
    type: "slab",
    name: "슬래브",
    polygon: [
      [0, 0],
      [6000, 0],
      [6000, 5000],
      [0, 5000],
    ],
    thickness: 200,
    elevation: 0,
    ...over,
  };
}

export function createColumn(over = {}) {
  return {
    id: nextId("c"),
    type: "column",
    name: "기둥",
    position: [0, 0],
    width: 400,
    depth: 400,
    height: 3000,
    elevation: 0,
    ...over,
  };
}

// 데모용 샘플: 바닥 슬래브 + 사각형 외벽 4면
export function sampleModel() {
  _seq = 1;
  const W = 8000, D = 6000, H = 3200, T = 200;
  const elements = [
    createSlab({
      name: "1층 바닥",
      polygon: [
        [0, 0],
        [W, 0],
        [W, D],
        [0, D],
      ],
      thickness: 250,
      elevation: 0,
    }),
    createWall({ name: "남측 외벽", start: [0, 0], end: [W, 0], height: H, thickness: T }),
    createWall({ name: "동측 외벽", start: [W, 0], end: [W, D], height: H, thickness: T }),
    createWall({ name: "북측 외벽", start: [W, D], end: [0, D], height: H, thickness: T }),
    createWall({ name: "서측 외벽", start: [0, D], end: [0, 0], height: H, thickness: T }),
    createSlab({
      name: "지붕 슬래브",
      polygon: [
        [0, 0],
        [W, 0],
        [W, D],
        [0, D],
      ],
      thickness: 250,
      elevation: H,
    }),
  ];
  return { project: { name: "샘플 건물", units: "mm" }, elements };
}

// 모델 유효성 간단 검증
export function validateModel(obj) {
  if (!obj || typeof obj !== "object") throw new Error("JSON 형식이 아닙니다.");
  if (!Array.isArray(obj.elements)) throw new Error("elements 배열이 없습니다.");
  obj.project = obj.project || { name: "불러온 프로젝트", units: "mm" };
  return obj;
}
