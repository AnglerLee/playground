# interaction

동물 스프라이트를 캔버스에 렌더링하고, DOM 레이어로 UI와 이펙트를 얹는 작은 인터랙션 프로토타입이다.  
현재 구조는 기능 추가보다 `입력 처리`, `상태 변화`, `월드 오브젝트`, `UI 갱신`의 책임을 분리하는 데 초점을 맞춘 리팩토링 버전이다.

## 실행

```bash
python -m http.server 8765
# 브라우저에서 http://localhost:8765/interaction/
```

빌드 단계는 없다. ES Modules, HTML5 Canvas, DOM만 사용한다.

## 구조

```text
interaction/
├─ index.html
├─ styles.css
├─ main.js
├─ animal.js
├─ scene.js
├─ stats.js
├─ care.js
├─ effects.js
├─ world-objects.js
├─ app/
│  ├─ ui.js
│  ├─ input-controller.js
│  └─ interaction-controller.js
├─ dialogue/
└─ animations/
```

### 핵심 역할

- `main.js`
  - 부트스트랩 전용.
  - 에셋 로드, 모듈 생성, 이벤트/루프 시작만 담당.
- `app/interaction-controller.js`
  - 현재 동물 전환.
  - 케어 액션 실행.
  - 음식/공/배설물 월드 오브젝트 흐름.
  - 자동 재개, 배설 생성, 저장/스탯 tick 루프.
- `app/input-controller.js`
  - 캔버스 포인터 입력 전담.
  - 쓰다듬기, 탭 인사, bath scrub, 빈 공간 dash 처리.
- `app/ui.js`
  - picker, stats panel, status, pet cursor 같은 DOM UI 관리.
- `animal.js`
  - 동물 상태 머신과 애니메이션 진행.
  - 외부에서 내부 필드 대신 상태 질의 메서드를 사용하도록 공개 API 제공.
- `world-objects.js`
  - 음식, 공, 배설물 DOM 오브젝트 관리.
  - 종류별 조회와 드래그 바인딩 API 제공.

## 상호작용 모델

- 동물 위 탭: 인사 점프.
- 동물 위 드래그: 쓰다듬기.
- `먹이`, `놀기` 버튼:
  - 동물 위 드롭 시 즉시 반응.
  - 빈 곳 드롭 시 월드 오브젝트를 두고 동물이 직접 가지러 감.
- `잠` 버튼: 즉시 수면 액션.
- `씻기` 버튼: 클릭으로 시작하고, 진행 중 동물 위를 문지르면 청결 증가.
- 빈 공간 클릭: 해당 지점으로 dash.
- `💩` 드래그: 청소하고 청결/행복 회복.

## 공개 API 메모

### `Animal`

- `isBusy()`
- `isInteractive()`
- `isResting()`
- `isBathing()`
- `getCurrentCareAction()`
- `hitTest(x, y)`
- `faceTowards(x)`
- `setState(name, opts)`

외부 모듈은 `_careOpts`, `_onArrive` 같은 내부 필드에 직접 접근하지 않는다.

### `WorldObjects`

- `add({ kind, x, y, ttlMs?, draggable? })`
- `move(id, x, y)`
- `remove(id)`
- `has(id)`
- `getItem(id)`
- `getFirstByKind(kind)`
- `getAllByKind(kind)`
- `forEach(callback)`
- `bindDrag(id, handlers)`
- `countByKind(kind)`
- `tickAge(dtSec)`
- `clearAll()`

## 상태/저장

- 스탯은 `hunger`, `happiness`, `cleanliness`, `energy` 네 가지.
- 저장 키는 `localStorage['interaction.stats.v1']`.
- 동물별 스탯을 유지한다.
- 페이지 재진입 시 offline decay를 적용한다.

## 리팩토링 원칙

- `main.js`에 도메인 로직을 다시 모으지 않는다.
- 입력 해석은 `input-controller.js`, 결과 실행은 `interaction-controller.js`에 둔다.
- UI 갱신은 가능한 한 `ui.js`를 통한다.
- 새 상호작용을 추가할 때는 `care.js`의 액션 정의와 `interaction-controller.js`의 실행 흐름을 함께 맞춘다.
