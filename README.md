# BIMelang
웹에서 동작하는 인공지능 기반 건축모델링 서비스

## 문제인식
대기업에서 만든 CAD, BIM 소프트웨어가 로컬에서만 동작하는 한계를 가진다.

## 솔루션 방향
디자인 소프트웨어의 발전 방향을 보면, 어도비의 포토샵/일러스트에서 캔바같은 웹서비스로 변환, 어도비의 프리미어프로에서 캡컷 같은 설치형 소프트웨어로 전환 중. 이와 같이 건축 설계 SW를 오토데스크에서 새로운 웹서비스 혹은 설치형 소프트웨어로 변환하려고함. 우리는 하이브리드 형으로 웹에서 데이터를 다루지만, 클라이언트 하드웨어 가속을 활용해서 새로운 유저경험을 제공하고자함. 

## 서비스 개요
* 이름: 빔이랑(BIMelang)
* 기술스택: 웹 기반 건축설계 JSON 데이터 편집/가공
* 출력 산출물: ifc 등 건축 SW 에서 사용할 수 있는 확장자.

## 개발 로드맵
1. 웹에서 건축 설계 모델링 디자인을 업로드, 다운로드 할 수 있고 가공, 편집 가능함
2. 생성형 API를 연결해서 사용자가 원하는 디자인을 생성하고 수정할 수 있음. 
3. 여러 모델링을 연결함

## 프로토타입 (MVP)
회사와 진행 여부를 논의하기 위한 **동작하는 최소 기능** 데모입니다. 로드맵 1단계에 집중했습니다.

### 구현된 기능
- **3D 뷰포트**: 브라우저에서 WebGL(Three.js) 하드웨어 가속으로 건물 모델 표시 (회전/줌/이동)
- **CAD-TO-BIM (DXF→BIM)**: DXF 도면 업로드 → 레이어를 객체 타입(기둥·벽·바닥·지붕)으로 자동 매핑 → BIM 변환. 자세히는 [docs/CAD_TO_BIM.md](docs/CAD_TO_BIM.md)
- **업로드 / 다운로드**: 건축 설계 데이터를 JSON으로 불러오고 저장
- **편집**: 요소(벽·기둥·슬래브) 클릭 선택 → 속성(좌표·크기·EL) 실시간 수정, 이동/크기/회전, 추가/삭제
- **IFC 내보내기**: 건축 SW에서 열 수 있는 `.ifc`(IFC4) 산출물 생성

### 실행 방법
```bash
npm start          # node server.js — 의존성 설치 불필요
```
- 랜딩 페이지: http://localhost:5173/ (서비스 소개)
- 에디터: http://localhost:5173/editor → "샘플 불러오기" 또는 "CAD 가져오기(DXF)"로 즉시 데모
- 샘플 데이터: `samples/house.json` (BIM JSON), `samples/plan.dxf` (CAD 도면)

### 구조
| 파일 | 역할 |
|------|------|
| `index.html` / `css/landing.css` | 메인 랜딩(소개) 페이지 |
| `editor.html` / `css/style.css` | 에디터 UI 레이아웃 (`/editor`) |
| `js/model.js` | 건축 데이터 모델(JSON 스키마) · 샘플 |
| `js/scene.js` | Three.js 3D 렌더링 · 선택(raycast) · 변형 기즈모 |
| `js/transform.js` | 이동·크기·회전 변형 계산(순수 함수) |
| `js/dxf.js` | DXF 도면 파서 |
| `js/cadToBim.js` | CAD → BIM 변환(레이어 매핑·객체 생성) |
| `js/ifc.js` | IFC4 내보내기 |
| `js/app.js` | 상태 관리 · 액션 연결 |
| `server.js` | 의존성 없는 정적 서버 (`/editor` 라우팅 포함) |

### 데이터 스키마 (요약)
```jsonc
{
  "project": { "name": "...", "units": "mm" },
  "elements": [
    { "type": "wall",   "start": [x,y], "end": [x,y], "height": 3000, "thickness": 200, "elevation": 0 },
    { "type": "slab",   "polygon": [[x,y],...], "thickness": 250, "elevation": 0 },
    { "type": "column", "position": [x,y], "width": 400, "depth": 400, "height": 3000, "elevation": 0 }
  ]
}
```

### 이번 MVP에서 의도적으로 제외한 것 (논의 후 결정)
- 생성형 AI 연결(로드맵 2단계), 다중 모델 연결(3단계)
- DWG·PDF 도면 변환 (현재 DXF만 지원), 곡선(ARC/스플라인) 인식, 블록(INSERT) 전개
- 정밀 IFC 형상(개구부/관계), 슬래브 비사각형 외곽 렌더링
- 사용자 인증·서버 저장·협업
