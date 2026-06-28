import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { slabCentroid } from "./transform.js";

// mm 단위 좌표를 그대로 쓰되, three는 m 스케일이 다루기 쉬워 0.001 배율로 표시한다.
const S = 0.001;

const COLORS = {
  wall: 0xb9c4d0,
  slab: 0x8f9bab,
  selected: 0x4c8dff,
};

export class Viewer {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks; // { onSelect, onTransform, onTransformEnd }
    this.meshes = new Map(); // id -> mesh

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1116);

    const { clientWidth: w, clientHeight: h } = container;
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 1000);
    this.camera.position.set(12, 10, 14);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(4, 1.5, 3);

    // 변형 기즈모 (이동/크기/회전)
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setTranslationSnap(100 * S); // 100mm 스냅
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(15));
    this.transform.addEventListener("dragging-changed", (e) => {
      this.controls.enabled = !e.value;
      if (!e.value) this.callbacks.onTransformEnd?.();
    });
    this.transform.addEventListener("objectChange", () => {
      if (this.transform.object) this.callbacks.onTransform?.(this.transform.object);
    });
    this.scene.add(this.transform);

    // 조명
    const hemi = new THREE.HemisphereLight(0xffffff, 0x33373d, 0.9);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(10, 20, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -30; dir.shadow.camera.right = 30;
    dir.shadow.camera.top = 30; dir.shadow.camera.bottom = -30;
    this.scene.add(dir);

    // 바닥 그리드
    const grid = new THREE.GridHelper(60, 60, 0x2a313c, 0x1c232d);
    this.scene.add(grid);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this._addCompass();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._downXY = null;
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      this._downXY = [e.clientX, e.clientY];
    });
    this.renderer.domElement.addEventListener("pointerup", (e) => this._onClick(e));

    window.addEventListener("resize", () => this._resize());
    this._animate();
  }

  // 동서남북 나침반 라벨 (모델 +y=북, +x=동 → three +z=북, +x=동)
  _addCompass() {
    const r = 14;
    const dirs = [
      ["N", 0, r, 0x4c8dff],
      ["S", 0, -r, 0x8b949e],
      ["E", r, 0, 0x8b949e],
      ["W", -r, 0, 0x8b949e],
    ];
    for (const [label, x, z, color] of dirs) {
      const sprite = this._makeTextSprite(label, color);
      sprite.position.set(x, 0.6, z);
      this.scene.add(sprite);
    }
  }

  _makeTextSprite(text, color) {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
    ctx.font = "bold 90px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, size / 2, size / 2);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.2, 1.2, 1.2);
    return sprite;
  }

  setMode(mode) {
    this.transform.setMode(mode); // 'translate' | 'scale' | 'rotate'
  }

  attach(id) {
    const mesh = this.meshes.get(id);
    if (mesh) this.transform.attach(mesh);
    else this.transform.detach();
  }
  detach() { this.transform.detach(); }
  getMesh(id) { return this.meshes.get(id); }

  _resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _onClick(e) {
    // 기즈모 조작 중에는 선택 변경 금지
    if (this.transform && (this.transform.dragging || this.transform.axis)) return;
    if (this._downXY) {
      const dx = e.clientX - this._downXY[0];
      const dy = e.clientY - this._downXY[1];
      if (Math.hypot(dx, dy) > 5) return; // 드래그(회전)
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.meshes.values()], false);
    this.callbacks.onSelect?.(hits.length ? hits[0].object.userData.id : null);
  }

  // 모델 전체를 다시 그린다 (MVP는 단순함을 위해 매 변경마다 재구축)
  render(model, selectedId) {
    this.transform.detach();
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.scene.remove(mesh);
    }
    this.meshes.clear();

    for (const el of model.elements) {
      const mesh = this._buildMesh(el);
      if (!mesh) continue;
      mesh.userData.id = el.id;
      this.meshes.set(el.id, mesh);
      this.scene.add(mesh);
    }
    this.highlight(selectedId);
    if (selectedId && this.meshes.has(selectedId)) this.attach(selectedId);
  }

  highlight(selectedId) {
    for (const [id, mesh] of this.meshes) {
      const isSel = id === selectedId;
      mesh.material.color.setHex(isSel ? COLORS.selected : COLORS[mesh.userData.type]);
      mesh.material.emissive.setHex(isSel ? 0x12305f : 0x000000);
    }
  }

  _buildMesh(el) {
    if (el.type === "wall") return this._buildWall(el);
    if (el.type === "slab") return this._buildSlab(el);
    return null;
  }

  _buildWall(el) {
    const [x1, y1] = el.start, [x2, y2] = el.end;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return null;
    const geom = new THREE.BoxGeometry(len * S, el.height * S, el.thickness * S);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const mesh = new THREE.Mesh(geom, this._material("wall"));
    mesh.position.set(mx * S, (el.elevation + el.height / 2) * S, my * S);
    mesh.rotation.y = -Math.atan2(y2 - y1, x2 - x1);
    this._finish(mesh, "wall");
    return mesh;
  }

  _buildSlab(el) {
    const c = slabCentroid(el.polygon);
    const local = el.polygon.map(([x, y]) => [x - c[0], y - c[1]]);
    const shape = new THREE.Shape();
    local.forEach(([x, y], i) => {
      const X = x * S, Y = y * S;
      i === 0 ? shape.moveTo(X, Y) : shape.lineTo(X, Y);
    });
    shape.closePath();
    const geom = new THREE.ExtrudeGeometry(shape, { depth: el.thickness * S, bevelEnabled: false });
    geom.rotateX(Math.PI / 2); // 평면 XY → 월드 XZ (모델 y → 월드 z)
    geom.translate(0, el.thickness * S, 0); // 바닥을 position.y 위로
    const mesh = new THREE.Mesh(geom, this._material("slab"));
    mesh.position.set(c[0] * S, (el.elevation || 0) * S, c[1] * S);
    mesh.userData.localMM = local;
    mesh.userData.baseThickness = el.thickness;
    this._finish(mesh, "slab");
    return mesh;
  }

  _material(type) {
    return new THREE.MeshStandardMaterial({
      color: COLORS[type], roughness: 0.85, metalness: 0.0, emissive: 0x000000,
    });
  }
  _finish(mesh, type) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.type = type;
  }

  fitView(model) {
    if (!model.elements.length) return;
    const box = new THREE.Box3();
    for (const mesh of this.meshes.values()) box.expandByObject(mesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    this.camera.position.set(center.x + size * 0.7, center.y + size * 0.6, center.z + size * 0.8);
    this.controls.update();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
