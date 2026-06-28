import { Viewer } from "./scene.js";
import { exportIFC } from "./ifc.js";
import {
  emptyModel, sampleModel, createWall, createSlab,
  validateModel, syncSeq,
} from "./model.js";
import {
  decomposeWall, decomposeSlab, translateElement, slabCentroid, DIRECTIONS,
} from "./transform.js";

// ---- 상태 ----
let model = sampleModel();
let selectedId = null;
let mode = "translate";

const $ = (id) => document.getElementById(id);
const status = (msg) => { $("status").textContent = msg; };

const viewer = new Viewer($("viewport"), {
  onSelect: (id) => select(id),
  onTransform: (mesh) => onTransform(mesh),
  onTransformEnd: () => { refresh(); status("변형 적용됨"); },
});

// ---- 렌더링 ----
function refresh({ rebuild = true } = {}) {
  if (rebuild) viewer.render(model, selectedId);
  else viewer.highlight(selectedId);
  $("count-elements").textContent = model.elements.length;
  $("proj-name").value = model.project.name || "";
  renderList();
  renderInspector();
}

function renderList() {
  const ul = $("element-list");
  ul.innerHTML = "";
  for (const el of model.elements) {
    const li = document.createElement("li");
    li.className = el.id === selectedId ? "active" : "";
    li.innerHTML = `<span>${escapeHtml(el.name || el.id)}</span><span class="tag">${el.type}</span>`;
    li.addEventListener("click", () => select(el.id));
    ul.appendChild(li);
  }
}

function renderInspector() {
  const hint = $("inspector-hint");
  const box = $("inspector-fields");
  const el = model.elements.find((e) => e.id === selectedId);
  if (!el) {
    hint.hidden = false;
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  hint.hidden = true;
  box.hidden = false;

  const rows = [field("name", "이름", el.name, "text")];
  if (el.type === "wall") {
    const len = Math.round(Math.hypot(el.end[0] - el.start[0], el.end[1] - el.start[1]));
    rows.push(
      pair(numField("start0", "시작 X", el.start[0]), numField("start1", "시작 Y", el.start[1])),
      pair(numField("end0", "끝 X", el.end[0]), numField("end1", "끝 Y", el.end[1])),
      pair(numField("height", "높이", el.height), numField("thickness", "두께", el.thickness)),
      numField("elevation", "기준 높이(EL)", el.elevation),
      `<p class="hint">길이 ${len}mm</p>`,
    );
  } else if (el.type === "slab") {
    const xs = el.polygon.map((p) => p[0]), ys = el.polygon.map((p) => p[1]);
    const w = Math.round(Math.max(...xs) - Math.min(...xs));
    const d = Math.round(Math.max(...ys) - Math.min(...ys));
    rows.push(
      pair(numField("width", "가로(W)", w), numField("depth", "세로(D)", d)),
      pair(numField("thickness", "두께", el.thickness), numField("elevation", "기준 높이(EL)", el.elevation)),
      `<p class="hint">가로·세로 변경 시 직사각형으로 재생성됩니다.</p>`,
    );
  }
  box.innerHTML = rows.join("");

  box.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", () => applyField(el, inp));
  });
}

function applyField(el, inp) {
  const key = inp.dataset.key;
  const val = inp.type === "number" ? parseFloat(inp.value) : inp.value;
  if (Number.isNaN(val) && inp.type === "number") return;
  switch (key) {
    case "start0": el.start[0] = val; break;
    case "start1": el.start[1] = val; break;
    case "end0": el.end[0] = val; break;
    case "end1": el.end[1] = val; break;
    case "width": resizeSlab(el, val, null); break;
    case "depth": resizeSlab(el, null, val); break;
    default: el[key] = val;
  }
  refresh();
  status(`${el.name || el.id} 수정됨`);
}

// 슬래브를 중심 기준 직사각형(W×D)으로 재생성
function resizeSlab(el, newW, newD) {
  const [cx, cy] = slabCentroid(el.polygon);
  const xs = el.polygon.map((p) => p[0]), ys = el.polygon.map((p) => p[1]);
  const w = newW ?? Math.max(...xs) - Math.min(...xs);
  const d = newD ?? Math.max(...ys) - Math.min(...ys);
  el.polygon = [
    [cx - w / 2, cy - d / 2],
    [cx + w / 2, cy - d / 2],
    [cx + w / 2, cy + d / 2],
    [cx - w / 2, cy + d / 2],
  ];
}

// 기즈모 변형 → 모델 반영 (재구축 없이 라이브)
function onTransform(mesh) {
  const el = model.elements.find((e) => e.id === mesh.userData.id);
  if (!el) return;
  if (el.type === "wall") {
    Object.assign(el, decomposeWall({
      pos: mesh.position, scale: mesh.scale, rotY: mesh.rotation.y,
      geomParams: mesh.geometry.parameters,
    }));
  } else if (el.type === "slab") {
    const r = decomposeSlab({
      pos: mesh.position, scale: mesh.scale, rotY: mesh.rotation.y,
      localMM: mesh.userData.localMM, baseThickness: mesh.userData.baseThickness,
    });
    el.polygon = r.polygon; el.thickness = r.thickness; el.elevation = r.elevation;
  }
  status(`${el.name || el.id} ${{ translate: "이동", scale: "크기", rotate: "회전" }[mode]} 중…`);
}

function select(id) {
  selectedId = id;
  viewer.highlight(id);
  viewer.attach(id);
  renderList();
  renderInspector();
}

// ---- 변형 모드 ----
function setMode(m) {
  mode = m;
  viewer.setMode(m);
  document.querySelectorAll(".btn.mode").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === m));
}
document.querySelectorAll(".btn.mode").forEach((b) =>
  b.addEventListener("click", () => setMode(b.dataset.mode)));

// ---- 키보드: 동서남북 이동 + 모드 + 삭제 ----
window.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;

  if (e.key === "1") return setMode("translate");
  if (e.key === "2") return setMode("scale");
  if (e.key === "3") return setMode("rotate");
  if (e.key === "Escape") return select(null);
  if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
    e.preventDefault();
    return deleteSelected();
  }
  if (!selectedId) return;
  const dir = DIRECTIONS[e.key];
  if (!dir) return;
  e.preventDefault();
  const step = e.shiftKey ? 1000 : 100;
  const el = model.elements.find((x) => x.id === selectedId);
  translateElement(el, dir[0] * step, dir[1] * step, dir[2] * step);
  refresh();
  const name = dir[0] ? (dir[0] > 0 ? "동" : "서") : dir[1] ? (dir[1] > 0 ? "북" : "남") : (dir[2] > 0 ? "상승" : "하강");
  status(`${el.name} ${name} ${step}mm 이동`);
});

// ---- 액션 ----
$("btn-sample").addEventListener("click", () => {
  model = sampleModel();
  selectedId = null;
  refresh();
  viewer.fitView(model);
  status("샘플 건물을 불러왔습니다.");
});

$("btn-add-wall").addEventListener("click", () => {
  const el = createWall();
  model.elements.push(el);
  refresh();
  select(el.id);
  status("벽을 추가했습니다. (방향키로 이동)");
});

$("btn-add-slab").addEventListener("click", () => {
  const el = createSlab();
  model.elements.push(el);
  refresh();
  select(el.id);
  status("슬래브를 추가했습니다.");
});

$("btn-delete").addEventListener("click", deleteSelected);
function deleteSelected() {
  if (!selectedId) { status("선택된 요소가 없습니다."); return; }
  model.elements = model.elements.filter((e) => e.id !== selectedId);
  selectedId = null;
  refresh();
  status("요소를 삭제했습니다.");
}

$("proj-name").addEventListener("input", (e) => {
  model.project.name = e.target.value;
});

// 업로드
$("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const obj = validateModel(JSON.parse(text));
    model = obj;
    syncSeq(model);
    selectedId = null;
    refresh();
    viewer.fitView(model);
    status(`${file.name} 불러옴 (요소 ${model.elements.length}개)`);
  } catch (err) {
    status(`불러오기 실패: ${err.message}`);
    alert(`불러오기 실패: ${err.message}`);
  }
  e.target.value = "";
});

// JSON 다운로드
$("btn-download").addEventListener("click", () => {
  download(fileName("json"), JSON.stringify(model, null, 2), "application/json");
  status("JSON으로 저장했습니다.");
});

// IFC 내보내기
$("btn-export-ifc").addEventListener("click", () => {
  download(fileName("ifc"), exportIFC(model), "application/x-step");
  status("IFC 파일로 내보냈습니다.");
});

// ---- 유틸 ----
function field(key, label, value, type = "text") {
  return `<label class="field"><span>${label}</span>
    <input data-key="${key}" type="${type}" value="${escapeAttr(value ?? "")}" /></label>`;
}
function numField(key, label, value) {
  return `<label class="field"><span>${label} (mm)</span>
    <input data-key="${key}" type="number" step="10" value="${Math.round(value ?? 0)}" /></label>`;
}
function pair(a, b) { return `<div class="field-grid">${a}${b}</div>`; }
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function safe(s) { return (s || "").replace(/[^\w가-힣\-]+/g, "_").replace(/^_+|_+$/g, ""); }
// 이름이 있으면 "BIMelang_<이름>.ext", 없으면 "BIMelang.ext"
function fileName(ext) {
  const n = safe(model.project.name);
  return n ? `BIMelang_${n}.${ext}` : `BIMelang.${ext}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }

// ---- 시작 ----
setMode("translate");
refresh();
viewer.fitView(model);
status("준비됨 · 요소 선택 후 방향키로 이동, 기즈모로 크기·회전");
