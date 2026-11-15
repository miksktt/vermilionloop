
const WORLD_SIZE = 520;
const HALF_WORLD = WORLD_SIZE / 2;
const EYE_HEIGHT = 3.5;
const TAU = Math.PI * 2;
const TILE_OFFSETS = [-WORLD_SIZE, 0, WORLD_SIZE];

const palette = {
  sky: 0x08bfa9,
  fog: 0x079d8e,
  deep: 0x061e1f,
  ground: 0x123f36,
  groundWarm: 0x7b2f1f,
  rust: 0x6d2119,
  ember: 0xf45124,
  peach: 0xff9362,
  cream: 0xffdb96,
  mint: 0x77ffd0,
};

const ui = {
  loading: document.querySelector('#loading'),
  start: document.querySelector('#start-screen'),
  enter: document.querySelector('#enter-button'),
  hud: document.querySelector('#hud'),
  pause: document.querySelector('#pause-screen'),
  resume: document.querySelector('#resume-button'),
  sound: document.querySelector('#sound-button'),
  pauseSound: document.querySelector('#pause-sound-button'),
  help: document.querySelector('#help-button'),
  pauseHelp: document.querySelector('#pause-help-button'),
  helpDialog: document.querySelector('#help-dialog'),
  closeHelp: document.querySelector('#close-help'),
  loops: document.querySelector('#loop-readout'),
  echoCount: document.querySelector('#echo-count'),
  coordinates: document.querySelector('#coordinates'),
  distance: document.querySelector('#distance'),
  signal: document.querySelector('#signal'),
  signalText: document.querySelector('#signal-text'),
  player1Input: document.querySelector('#player1-input'),
  player2Input: document.querySelector('#player2-input'),
  levelSelect: document.querySelector('#level-select'),
  levelDescription: document.querySelector('#level-description'),
  modeSelect: document.querySelector('#mode-select'),
  modeDescription: document.querySelector('#mode-description'),
  inputWarning: document.querySelector('#input-warning'),
  gamepadStatus: document.querySelector('#gamepad-status'),
  splitOverlay: document.querySelector('#split-overlay'),
  player1Label: document.querySelector('#player1-label'),
  player2Label: document.querySelector('#player2-label'),
  menu: document.querySelector('#menu-button'),
  pausePlayer1Input: document.querySelector('#pause-player1-input'),
  pausePlayer2Input: document.querySelector('#pause-player2-input'),
  pauseInputWarning: document.querySelector('#pause-input-warning'),
  pauseGamepadStatus: document.querySelector('#pause-gamepad-status'),
  cancelControls: document.querySelector('#cancel-controls'),
};

let renderer;
let scene;
let camera;
let camera2;
let sun;
let sunTarget;
let skyAnchor;
let motes;
let fireflySwarm;
let worldReady = false;
let started = false;
let helpOpen = false;
let signalTimer = 0;
let hadPointerLock = false;
let dragLooking = false;
let lastPointerX = 0;
let lastPointerY = 0;
let currentLevel = 'forest';
let currentGameMode = 'survey';

const GAME_MODE_INFO = {
  survey: { label: 'SURVEYORS / TAG', description: 'Explore on foot with tag, temporary steps, power crystals and charged cubes.' },
  race: { label: 'HOVER SHIP RACE', description: 'Three-lap split-screen racing through glowing checkpoints in low-poly mini ships.' },
  freefly: { label: 'FREE FLYING', description: 'Take the mini ships anywhere with no checkpoint order or finish line.' },
};

const LEVEL_INFO = {
  forest: { label: 'VERMILION FOREST', description: 'Dense forest, strange towers and hidden clearings.' },
  city: { label: 'RUINED ABSTRACT CITY', description: 'Widely scattered simplified buildings, dark windows, broken gateways and eerie empty streets.' },
  skyline: { label: 'HIGH TOWER TRAVERSE', description: 'Dense chains of rooftop platforms built for repeated jumps, shortcuts and aerial chases.' },
  mountains: { label: 'HIGH MOUNTAINS', description: 'A few very high sharp peaks separated by broad, recognizable mountain valleys.' },
};

const isTouchDevice = (navigator.maxTouchPoints || 0) > 0 || window.matchMedia('(pointer: coarse)').matches;
function makeTouchControl() {
  return {
    movePointerId: null,
    lookPointerId: null,
    moveStartX: 0,
    moveStartY: 0,
    moveForward: 0,
    moveSide: 0,
    sprint: false,
    lookLastX: 0,
    lookLastY: 0,
    lastLookTap: 0,
  };
}
const touchControls = [makeTouchControl(), makeTouchControl()];

const keys = Object.create(null);
const inputAssignments = ['keyboard', 'gamepad-0'];
const gamepadButtonState = [[], []];

function makePlayer(x, z, yaw) {
  return {
    position: new THREE.Vector3(x, 0, z),
    yaw,
    pitch: 0.08,
    verticalVelocity: 0,
    grounded: true,
    distance: 0,
    loop: 1,
    bob: 0,
    towerRoofIndex: -1,
    powerTimers: { speed: 0, jump: 0, fly: 0, blast: 0, shrink: 0, grow: 0 },
    appliedScale: 1,
    isRunning: false,
    lastPowerPickupType: '',
    powerOverlayFlashUntil: 0,
  };
}

const players = [
  makePlayer(-4, 28, -0.852),
  makePlayer(4, 21, Math.PI - 0.852),
];

// The first two crystals have guaranteed clearings directly ahead of the
// starting views. Later respawns still move to newly selected locations.
const INITIAL_POWERUP_DISTANCE = 34;
const INITIAL_POWERUP_ANCHORS = players.map((p) => ({
  x: p.position.x - Math.sin(p.yaw) * INITIAL_POWERUP_DISTANCE,
  z: p.position.z - Math.cos(p.yaw) * INITIAL_POWERUP_DISTANCE,
}));

function insideInitialPowerupClearing(x, z, extra = 0) {
  return INITIAL_POWERUP_ANCHORS.some((anchor) =>
    wrappedDistanceSquared(x, z, anchor.x, anchor.z) < (12 + extra) ** 2);
}

// Keep the original world-building code anchored to Player 1 during setup.
const player = players[0];

const treeColliders = [];
const structureColliders = [];
const animatedStructures = [];
const towerVisuals = [];
const towerStates = [];
const echoVisuals = [];
const skyLightVisuals = [];
const fireflyVisuals = [];
const discoveredEchoes = new Set();

const buildingDefs = [
  { x: 67, z: -112, scale: 1.08, rotation: 0.08 },
  { x: -148, z: 89, scale: 0.84, rotation: -0.44 },
  { x: 186, z: 158, scale: 0.72, rotation: 0.61 },
  { x: -91, z: -186, scale: 0.63, rotation: 0.25 },
  { x: 16, z: 196, scale: 0.92, rotation: -0.18 },
];

const echoDefs = [
  { x: 86, z: -96, text: 'You have walked this way before.' },
  { x: -128, z: 78, text: 'The buildings lower themselves when you sleep.' },
  { x: 204, z: 145, text: 'The trees remember a different sky.' },
  { x: -72, z: -174, text: 'No map can show a place with no edge.' },
  { x: 36, z: 183, text: 'The first survey team is still ahead of you.' },
  { x: -204, z: -72, text: 'The sixth signal was sent tomorrow.' },
];

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

let random = mulberry32(719451);

function analyticHeightAt(x, z) {
  const u = (x / WORLD_SIZE) * TAU;
  const v = (z / WORLD_SIZE) * TAU;
  if (currentLevel === 'city') {
    return -4.6 + Math.sin(u * 2) * 1.25 + Math.cos(v * 3) * 0.95 + Math.sin(u * 5 + v * 4) * 0.45;
  }
  if (currentLevel === 'skyline') {
    return -5.2 + Math.sin(u * 2 + 0.4) * 1.0 + Math.cos(v * 2 - 0.7) * 0.75;
  }
  if (currentLevel === 'mountains') {
    // Fixed, widely spaced peaks create recognizable valleys instead of a continuously
    // rippling mountain field. Wrapped distance keeps the terrain seamless at the loop edge.
    const peaks = [
      [-176, -126, 82, 58], [154, -96, 96, 66], [-118, 142, 112, 70],
      [112, 166, 88, 60], [8, -188, 74, 54], [205, 52, 104, 68],
    ];
    let height = -13.5;
    for (const [px, pz, peakHeight, radius] of peaks) {
      const dx = wrappedDelta(x, px), dz = wrappedDelta(z, pz);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= radius) continue;
      const t = 1 - d / radius;
      // A high power keeps lower slopes broad while sharpening the summit dramatically.
      height += peakHeight * Math.pow(t, 2.65);
    }
    // Very gentle valley undulation, kept low enough that the mountain layout remains stable.
    height += Math.sin(u + 0.4) * 2.1 + Math.cos(v - 0.7) * 1.7;
    return height;
  }
  return -3.8
    + Math.sin(u * 2 + 0.35) * Math.cos(v * 3 - 0.6) * 7.8
    + Math.sin(u * 4 + v * 2 + 1.4) * 3.5
    + Math.cos(u * 3 - v * 5 - 0.2) * 2.2
    + Math.sin(u * 7 + v * 4) * 0.9;
}

function wrappedDelta(a, b) {
  let delta = a - b;
  if (delta > HALF_WORLD) delta -= WORLD_SIZE;
  if (delta < -HALF_WORLD) delta += WORLD_SIZE;
  return delta;
}

function wrappedDistanceSquared(x1, z1, x2, z2) {
  const dx = wrappedDelta(x1, x2);
  const dz = wrappedDelta(z1, z2);
  return dx * dx + dz * dz;
}

function buildRenderer() {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.55));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'First-person view of the Vermilion Loop');
  document.querySelector('#game').prepend(renderer.domElement);
}

function buildScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.FogExp2(palette.fog, 0.0057);

  const splitAspect = Math.max(0.25, (window.innerWidth * 0.5) / window.innerHeight);
  camera = new THREE.PerspectiveCamera(72, splitAspect, 0.1, 560);
  camera2 = new THREE.PerspectiveCamera(72, splitAspect, 0.1, 560);
  camera.rotation.order = 'YXZ';
  camera2.rotation.order = 'YXZ';
  players.forEach((viewPlayer) => {
    viewPlayer.position.y = heightAt(viewPlayer.position.x, viewPlayer.position.z) + EYE_HEIGHT;
  });
  // Begin facing the other surveyor, with the whole figure in view.
  players.forEach((p, i) => {
    const other = players[1 - i];
    const distance = Math.sqrt(wrappedDistanceSquared(p.position.x, p.position.z, other.position.x, other.position.z));
    p.pitch = Math.atan2(other.position.y - EYE_HEIGHT + 2.45 - p.position.y, distance);
  });
  camera.position.copy(players[0].position);
  camera.rotation.set(players[0].pitch, players[0].yaw, 0, 'YXZ');
  camera2.position.copy(players[1].position);
  camera2.rotation.set(players[1].pitch, players[1].yaw, 0, 'YXZ');

  const hemisphere = new THREE.HemisphereLight(0x80ffdc, 0x5b160f, 2.15);
  scene.add(hemisphere);

  sun = new THREE.DirectionalLight(0xff8a58, 3.5);
  sun.position.set(52, 92, 34);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -92;
  sun.shadow.camera.right = 92;
  sun.shadow.camera.top = 92;
  sun.shadow.camera.bottom = -92;
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 250;
  sun.shadow.bias = -0.00035;
  sunTarget = new THREE.Object3D();
  scene.add(sun, sunTarget);
  sun.target = sunTarget;

  const underGlow = new THREE.PointLight(0xff4f22, 25, 74, 2);
  underGlow.position.set(67, heightAt(67, -112) + 35, -112);
  scene.add(underGlow);

  buildTerrain();
  buildForest();
  buildRocksAndGrowth();
  buildArchitecture();
  buildLevelStructures();
  buildEchoes();
  buildSky();
  buildMotes();
  buildFireflies();
  buildSurveyors();
  buildNPCSurveyors();
  if (currentGameMode === 'survey') {
    buildConstruction();
    buildThrowableKit();
    buildPowerups();
  } else {
    buildVehicleSystem();
  }
}

function buildTerrain() {
  let geometry = new THREE.PlaneGeometry(WORLD_SIZE * 3, WORLD_SIZE * 3, 288, 288);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    positions.setY(i, analyticHeightAt(x, z));
  }

  geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();
  const nonIndexedPositions = geometry.attributes.position;
  const colours = new Float32Array(nonIndexedPositions.count * 3);
  const colour = new THREE.Color();

  for (let i = 0; i < nonIndexedPositions.count; i += 3) {
    const cx = (
      nonIndexedPositions.getX(i)
      + nonIndexedPositions.getX(i + 1)
      + nonIndexedPositions.getX(i + 2)
    ) / 3;
    const cz = (
      nonIndexedPositions.getZ(i)
      + nonIndexedPositions.getZ(i + 1)
      + nonIndexedPositions.getZ(i + 2)
    ) / 3;
    const cy = (
      nonIndexedPositions.getY(i)
      + nonIndexedPositions.getY(i + 1)
      + nonIndexedPositions.getY(i + 2)
    ) / 3;
    const pattern = Math.sin(cx * 0.073 + cz * 0.041) + Math.cos(cz * 0.092 - cx * 0.028);

    if (cy > 5.5 && pattern > 0.35) {
      colour.setHex(palette.groundWarm).offsetHSL(0, 0.04, pattern * 0.018);
    } else if (pattern < -1.0) {
      colour.setHex(0x082f2d).offsetHSL(0.01, 0.02, pattern * 0.014);
    } else {
      colour.setHex(palette.ground).offsetHSL(pattern * 0.004, 0.02, pattern * 0.022);
    }

    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = (i + vertex) * 3;
      colours[offset] = colour.r;
      colours[offset + 1] = colour.g;
      colours[offset + 2] = colour.b;
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  scene.add(terrain);

  const lowMist = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE * 3, WORLD_SIZE * 3),
    new THREE.MeshBasicMaterial({
      color: 0x16bba3,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    }),
  );
  lowMist.rotation.x = -Math.PI / 2;
  lowMist.position.y = -6.6;
  scene.add(lowMist);
}

function isClearOfLandmarks(x, z, clearance) {
  if (players.some((p) => wrappedDistanceSquared(x, z, p.position.x, p.position.z) < clearance * clearance)) return false;
  return buildingDefs.every((building) => (
    wrappedDistanceSquared(x, z, building.x, building.z) > (clearance + 17) ** 2
  ));
}

function buildForest() {
  const trees = [];
  let attempts = 0;

  const targetTrees = currentLevel === 'forest' ? 238 : currentLevel === 'mountains' ? 82 : currentLevel === 'city' ? 24 : 10;
  const maxAttempts = Math.max(500, targetTrees * 14);
  while (trees.length < targetTrees && attempts < maxAttempts) {
    attempts += 1;
    const x = random() * WORLD_SIZE - HALF_WORLD;
    const z = random() * WORLD_SIZE - HALF_WORLD;
    const scale = 0.72 + random() * 1.2;
    if (!isClearOfLandmarks(x, z, 6.6 + scale * 2.05)) continue;
    if (insideInitialPowerupClearing(x, z, scale * 2.2)) continue;
    trees.push({ x, z, scale, rotation: random() * TAU, tint: random() });
    treeColliders.push({ x, z, radius: 0.68 + scale * 0.45 });
  }

  const instanceCount = trees.length * 9;
  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.72, 6, 5, 1);
  const branchGeometry = new THREE.CylinderGeometry(0.15, 0.24, 3.4, 4, 1);
  branchGeometry.translate(0, 1.7, 0);
  const crownGeometry = new THREE.ConeGeometry(3.4, 8.5, 5, 1);
  crownGeometry.translate(0, 4.25, 0);
  const accentCrownGeometry = new THREE.ConeGeometry(2.35, 5.9, 5, 1);
  accentCrownGeometry.translate(0, 2.95, 0);

  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x351511,
    roughness: 1,
    flatShading: true,
  });
  const crownMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
    flatShading: true,
  });

  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, instanceCount);
  trunks.name = 'collision-solid';
  const leftBranches = new THREE.InstancedMesh(branchGeometry, trunkMaterial, instanceCount);
  const rightBranches = new THREE.InstancedMesh(branchGeometry, trunkMaterial, instanceCount);
  const lowerCrowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, instanceCount);
  const middleCrowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, instanceCount);
  const topCrowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, instanceCount);
  const sideCrowns = new THREE.InstancedMesh(accentCrownGeometry, crownMaterial, instanceCount);
  const dummy = new THREE.Object3D();
  const warm = new THREE.Color();
  let index = 0;

  for (const offsetX of TILE_OFFSETS) {
    for (const offsetZ of TILE_OFFSETS) {
      for (const tree of trees) {
        const x = tree.x + offsetX;
        const z = tree.z + offsetZ;
        const ground = heightAt(x, z);
        const scale = tree.scale;

        dummy.position.set(x, ground + 3 * scale, z);
        dummy.rotation.set(0, tree.rotation, 0);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(index, dummy.matrix);

        dummy.position.set(x - Math.sin(tree.rotation) * 0.45 * scale, ground + 4.15 * scale, z - Math.cos(tree.rotation) * 0.45 * scale);
        dummy.rotation.set(0.18, tree.rotation - 0.44, 1.02);
        dummy.scale.set(scale * 0.62, scale * 0.72, scale * 0.62);
        dummy.updateMatrix();
        leftBranches.setMatrixAt(index, dummy.matrix);

        dummy.position.set(x + Math.sin(tree.rotation + 0.5) * 0.52 * scale, ground + 5.85 * scale, z + Math.cos(tree.rotation + 0.5) * 0.52 * scale);
        dummy.rotation.set(-0.14, tree.rotation + 0.61, -1.05);
        dummy.scale.set(scale * 0.58, scale * 0.68, scale * 0.58);
        dummy.updateMatrix();
        rightBranches.setMatrixAt(index, dummy.matrix);

        dummy.position.set(x, ground + 1.7 * scale, z);
        dummy.rotation.set(0, tree.rotation, 0);
        dummy.scale.set(scale * 1.28, scale * 0.95, scale * 1.28);
        dummy.updateMatrix();
        lowerCrowns.setMatrixAt(index, dummy.matrix);

        dummy.position.set(x, ground + 6.1 * scale, z);
        dummy.scale.set(scale * 1.02, scale * 0.9, scale * 1.02);
        dummy.updateMatrix();
        middleCrowns.setMatrixAt(index, dummy.matrix);

        dummy.position.set(x + Math.cos(tree.rotation) * 0.78 * scale, ground + 6.9 * scale, z + Math.sin(tree.rotation) * 0.78 * scale);
        dummy.rotation.set(0, tree.rotation + 0.3, 0);
        dummy.scale.set(scale * 0.74, scale * 0.82, scale * 0.74);
        dummy.updateMatrix();
        sideCrowns.setMatrixAt(index, dummy.matrix);

        dummy.position.set(x, ground + 10.3 * scale, z);
        dummy.scale.set(scale * 0.73, scale * 0.82, scale * 0.73);
        dummy.updateMatrix();
        topCrowns.setMatrixAt(index, dummy.matrix);

        const isWarm = tree.tint > 0.28;
        warm.setHex(isWarm ? 0x852719 : 0x12342f);
        warm.offsetHSL((tree.tint - 0.5) * 0.018, 0.04, (tree.tint - 0.5) * 0.075);
        lowerCrowns.setColorAt(index, warm);

        warm.setHex(isWarm ? 0xa4381e : 0x17453c);
        warm.offsetHSL((tree.tint - 0.5) * 0.016, 0.03, (tree.tint - 0.5) * 0.06);
        middleCrowns.setColorAt(index, warm);

        warm.setHex(isWarm ? 0x963017 : 0x1b4d44);
        warm.offsetHSL((tree.tint - 0.5) * 0.014, 0.03, (tree.tint - 0.5) * 0.05);
        sideCrowns.setColorAt(index, warm);

        warm.setHex(isWarm ? 0xb74120 : 0x1b594a);
        warm.offsetHSL((tree.tint - 0.5) * 0.012, 0.02, (tree.tint - 0.5) * 0.055);
        topCrowns.setColorAt(index, warm);

        index += 1;
      }
    }
  }

  for (const mesh of [trunks, leftBranches, rightBranches, lowerCrowns, middleCrowns, sideCrowns, topCrowns]) {
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}

function buildRocksAndGrowth() {
  const rockCount = currentLevel === 'mountains' ? 170 : currentLevel === 'city' ? 95 : currentLevel === 'skyline' ? 35 : 82;
  const growthCount = currentLevel === 'forest' ? 390 : currentLevel === 'mountains' ? 160 : currentLevel === 'city' ? 75 : 30;
  const bushCount = currentLevel === 'forest' ? 235 : currentLevel === 'mountains' ? 75 : currentLevel === 'city' ? 28 : 12;
  const rocks = [];
  const growth = [];
  const bushes = [];

  for (let i = 0; i < rockCount; i += 1) {
    const x = random() * WORLD_SIZE - HALF_WORLD;
    const z = random() * WORLD_SIZE - HALF_WORLD;
    if (insideInitialPowerupClearing(x, z, 4.5)) continue;
    rocks.push({
      x,
      z,
      scale: 0.45 + random() * 1.75,
      rotation: random() * TAU,
      tint: random(),
    });
  }

  for (let i = 0; i < growthCount; i += 1) {
    const x = random() * WORLD_SIZE - HALF_WORLD;
    const z = random() * WORLD_SIZE - HALF_WORLD;
    if (insideInitialPowerupClearing(x, z, 3.5)) continue;
    growth.push({
      x,
      z,
      scale: 0.3 + random() * 1.0,
      rotation: random() * TAU,
      tint: random(),
    });
  }

  for (let i = 0; i < bushCount; i += 1) {
    const x = random() * WORLD_SIZE - HALF_WORLD;
    const z = random() * WORLD_SIZE - HALF_WORLD;
    // Bushes are visual rather than collidable, so they can thicken the forest floor
    // without turning narrow spaces into invisible obstacles.
    if (!isClearOfLandmarks(x, z, 4.2)) continue;
    if (insideInitialPowerupClearing(x, z, 4.5)) continue;
    bushes.push({
      x,
      z,
      scale: 0.38 + random() * 1.15,
      rotation: random() * TAU,
      tint: random(),
      spread: 0.7 + random() * 0.9,
    });
  }

  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const rockMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, rocks.length * 9);
  rockMesh.name = 'collision-solid';

  const growthGeometry = new THREE.ConeGeometry(0.74, 2.9, 3, 1);
  growthGeometry.translate(0, 1.45, 0);
  const growthMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const growthMesh = new THREE.InstancedMesh(growthGeometry, growthMaterial, growth.length * 9);

  const bushGeometryA = new THREE.DodecahedronGeometry(1.15, 0);
  const bushGeometryB = new THREE.DodecahedronGeometry(0.86, 0);
  const bushMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const bushMeshA = new THREE.InstancedMesh(bushGeometryA, bushMaterial, bushes.length * 9);
  const bushMeshB = new THREE.InstancedMesh(bushGeometryB, bushMaterial, bushes.length * 9);

  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();
  let rockIndex = 0;
  let growthIndex = 0;
  let bushIndex = 0;

  for (const offsetX of TILE_OFFSETS) {
    for (const offsetZ of TILE_OFFSETS) {
      for (const rock of rocks) {
        const x = rock.x + offsetX;
        const z = rock.z + offsetZ;
        dummy.position.set(x, heightAt(x, z) + rock.scale * 0.65, z);
        dummy.rotation.set(rock.tint, rock.rotation, rock.tint * 0.5);
        dummy.scale.set(rock.scale * 1.35, rock.scale * 0.72, rock.scale);
        dummy.updateMatrix();
        rockMesh.setMatrixAt(rockIndex, dummy.matrix);
        colour.setHex(rock.tint > 0.55 ? 0x6e281c : 0x124b43);
        colour.offsetHSL(0, 0, (rock.tint - 0.5) * 0.08);
        rockMesh.setColorAt(rockIndex, colour);
        rockIndex += 1;
      }

      for (const plant of growth) {
        const x = plant.x + offsetX;
        const z = plant.z + offsetZ;
        dummy.position.set(x, heightAt(x, z), z);
        dummy.rotation.set(0, plant.rotation, 0.12 * (plant.tint - 0.5));
        dummy.scale.set(plant.scale * 0.62, plant.scale, plant.scale * 0.62);
        dummy.updateMatrix();
        growthMesh.setMatrixAt(growthIndex, dummy.matrix);
        colour.setHex(plant.tint > 0.44 ? 0xd14520 : 0x22a07f);
        colour.offsetHSL(0, 0.03, (plant.tint - 0.5) * 0.08);
        growthMesh.setColorAt(growthIndex, colour);
        growthIndex += 1;
      }

      for (const bush of bushes) {
        const x = bush.x + offsetX;
        const z = bush.z + offsetZ;
        const ground = heightAt(x, z);
        const s = bush.scale;

        dummy.position.set(x, ground + 0.72 * s, z);
        dummy.rotation.set(0.08 * (bush.tint - 0.5), bush.rotation, 0.04 * (bush.tint - 0.5));
        dummy.scale.set(1.4 * s, 0.72 * s, 1.08 * s);
        dummy.updateMatrix();
        bushMeshA.setMatrixAt(bushIndex, dummy.matrix);

        const side = bush.rotation + 1.15;
        dummy.position.set(
          x + Math.cos(side) * bush.spread * s,
          ground + 0.9 * s,
          z + Math.sin(side) * bush.spread * s,
        );
        dummy.rotation.set(-0.05, bush.rotation + 0.65, 0.08);
        dummy.scale.set(1.0 * s, 0.86 * s, 0.95 * s);
        dummy.updateMatrix();
        bushMeshB.setMatrixAt(bushIndex, dummy.matrix);

        colour.setHex(bush.tint > 0.57 ? 0x7a281c : bush.tint > 0.23 ? 0x16564a : 0x103a35);
        colour.offsetHSL((bush.tint - 0.5) * 0.018, 0.02, (bush.tint - 0.5) * 0.06);
        bushMeshA.setColorAt(bushIndex, colour);
        colour.offsetHSL(0.006, 0.02, 0.035);
        bushMeshB.setColorAt(bushIndex, colour);
        bushIndex += 1;
      }
    }
  }

  for (const mesh of [rockMesh, growthMesh, bushMeshA, bushMeshB]) {
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = mesh !== growthMesh;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}
function addBox(group, size, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createBuildingPrototype() {
  const group = new THREE.Group();
  const coral = new THREE.MeshStandardMaterial({ color: palette.peach, roughness: 0.83, flatShading: true });
  const coralShade = new THREE.MeshStandardMaterial({ color: 0xc94d35, roughness: 0.92, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x08282b, roughness: 0.9, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0b5e5b,
    emissive: 0x087369,
    emissiveIntensity: 0.68,
    roughness: 0.38,
  });
  const light = new THREE.MeshStandardMaterial({
    color: palette.cream,
    emissive: palette.ember,
    emissiveIntensity: 3.2,
    roughness: 0.5,
  });

  addBox(group, [11, 43, 11], [0, 21.5, 0], dark);
  addBox(group, [47, 8.5, 43], [0, 43.25, 0], dark);
  addBox(group, [44, 26, 40], [0, 60.5, 0], coral);
  addBox(group, [46, 2.1, 42], [0, 48.2, 0], coralShade);

  for (let i = -2; i <= 2; i += 1) {
    addBox(group, [6.2, 4.3, 0.55], [i * 8.2, 47.1, -21.73], glass);
    addBox(group, [6.2, 4.3, 0.55], [i * 8.2, 47.1, 21.73], glass);
  }

  for (let i = -1.5; i <= 1.5; i += 1) {
    addBox(group, [0.55, 4.3, 6.4], [-23.73, 47.1, i * 8.2], glass);
    addBox(group, [0.55, 4.3, 6.4], [23.73, 47.1, i * 8.2], glass);
  }

  for (let i = -2; i <= 2; i += 1) {
    addBox(group, [0.42, 26.4, 40.4], [i * 8.75, 60.5, 0], coralShade);
  }

  for (const x of [-13, 0, 13]) {
    for (const z of [-12, 0, 12]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.4, 8), light);
      lamp.position.set(x, 38.85, z);
      lamp.castShadow = false;
      group.add(lamp);
    }
  }

  return group;
}

function createFloatingBlockPrototype() {
  const group = new THREE.Group();
  const coral = new THREE.MeshStandardMaterial({ color: 0xff7850, roughness: 0.88, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a3535, roughness: 1, flatShading: true });
  addBox(group, [25, 21, 22], [0, 34, 0], coral);
  addBox(group, [27, 3.2, 24], [0, 23.7, 0], dark);
  addBox(group, [3.5, 13, 3.5], [0, 16.5, 0], dark);
  return group;
}

function buildArchitecture() {
  const prototype = createBuildingPrototype();

  buildingDefs.forEach((building, buildingIndex) => {
    structureColliders.push({
      x: building.x,
      z: building.z,
      radius: 7 * building.scale,
      kind: 'tower',
      towerIndex: buildingIndex,
      scale: building.scale,
      rotation: building.rotation,
    });
    const instance = prototype.clone(true);
    const uniqueMaterials = new Set();
    instance.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      if (Array.isArray(child.material)) {
        child.material = child.material.map((material) => {
          const clone = material.clone();
          uniqueMaterials.add(clone);
          return clone;
        });
      } else {
        child.material = child.material.clone();
        uniqueMaterials.add(child.material);
      }
    });
    const baseY = heightAt(building.x, building.z) - 0.2;
    instance.position.set(building.x, baseY, building.z);
    instance.rotation.y = building.rotation;
    instance.scale.setScalar(building.scale);
    instance.userData.baseX = building.x;
    instance.userData.baseZ = building.z;
    instance.userData.baseRotation = building.rotation;
    instance.userData.yOffset = -0.2;
    instance.userData.phase = buildingIndex * 1.37;
    instance.userData.floatAmplitude = 0.16;
    instance.userData.floatSpeed = 0.08;
    instance.userData.driftAmplitude = 0.16;
    instance.userData.rotationAmplitude = 0.012;
    instance.userData.motionStyle = 'tower';
    animatedStructures.push(instance);
    towerVisuals.push({
      instance,
      materials: [...uniqueMaterials].map((material) => ({
        material,
        baseColor: material.color?.clone?.() || null,
        baseEmissive: material.emissive?.clone?.() || null,
        baseEmissiveIntensity: Number(material.emissiveIntensity || 0),
      })),
    });
    towerStates.push({ energy: 0, activeUntil: -Infinity });
    scene.add(instance);
  });

  const smallPrototype = createFloatingBlockPrototype();
  const fragments = [
    { x: -24, z: -128, scale: 0.74, rotation: 0.4 },
    { x: 136, z: 33, scale: 0.55, rotation: -0.2 },
    { x: -206, z: -12, scale: 0.68, rotation: 0.75 },
    { x: 62, z: 111, scale: 0.48, rotation: -0.58 },
  ];

  fragments.forEach((fragment, fragmentIndex) => {
    structureColliders.push({ x: fragment.x, z: fragment.z, radius: 2.8 * fragment.scale });
    const instance = smallPrototype.clone(true);
    const baseY = heightAt(fragment.x, fragment.z);
    instance.position.set(fragment.x, baseY, fragment.z);
    instance.rotation.y = fragment.rotation;
    instance.scale.setScalar(fragment.scale);
    instance.userData.baseX = fragment.x;
    instance.userData.baseZ = fragment.z;
    instance.userData.baseRotation = fragment.rotation;
    instance.userData.yOffset = 0;
    instance.userData.phase = fragmentIndex * 1.71 + 2.2;
    instance.userData.floatAmplitude = 0.58;
    instance.userData.floatSpeed = 0.23;
    instance.userData.driftAmplitude = 0.32;
    instance.userData.rotationAmplitude = 0.038;
    instance.userData.motionStyle = 'fragment';
    animatedStructures.push(instance);
    scene.add(instance);
  });
}


function addLevelPlatform(x, z, width, depth, height, colour = 0x3b4b47, accent = 0xa2ffd9, rotation = 0) {
  const ground = heightAt(x, z);
  const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.94, flatShading: true });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.32 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMaterial);
  const group = new THREE.Group();
  group.add(mesh, edges);
  group.position.set(x, ground + height * 0.5, z);
  group.rotation.y = rotation;
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(group);
  levelPlatforms.push({ x, z, width, depth, bottom: ground, top: ground + height, height, rotation, group, mesh, material, edgeMaterial });
  return levelPlatforms[levelPlatforms.length - 1];
}

function addCityWindows(group, width, depth, height, sides = 4) {
  const windowMaterial = new THREE.MeshBasicMaterial({ color: 0x020708 });
  const rows = Math.max(1, Math.min(4, Math.floor(height / 6)));
  if (sides === 6) {
    const radius = Math.min(width, depth) * 0.47;
    for (let side = 0; side < 6; side += 1) {
      const a = side / 6 * TAU;
      for (let row = 0; row < rows; row += 1) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.05, 0.09), windowMaterial);
        panel.position.set(Math.sin(a) * (radius + 0.025), -height * 0.5 + 2.2 + row * 3.7, Math.cos(a) * (radius + 0.025));
        panel.rotation.y = a;
        group.add(panel);
      }
    }
    return;
  }
  const columnsX = Math.max(1, Math.min(4, Math.floor(width / 5)));
  const columnsZ = Math.max(1, Math.min(4, Math.floor(depth / 5)));
  for (let row = 0; row < rows; row += 1) {
    const y = -height * 0.5 + 2.2 + row * 3.7;
    for (let col = 0; col < columnsX; col += 1) {
      const x = columnsX === 1 ? 0 : -width * 0.32 + col * (width * 0.64 / (columnsX - 1));
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.0, 0.10), windowMaterial);
        panel.position.set(x, y, side * (depth * 0.5 + 0.025));
        group.add(panel);
      }
    }
    for (let col = 0; col < columnsZ; col += 1) {
      const z = columnsZ === 1 ? 0 : -depth * 0.32 + col * (depth * 0.64 / (columnsZ - 1));
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.0, 1.55), windowMaterial);
        panel.position.set(side * (width * 0.5 + 0.025), y, z);
        group.add(panel);
      }
    }
  }
}

function decorateCityBuilding(platform, style, colour, accent, seedValue) {
  const r = mulberry32(seedValue);
  const { width: w, depth: d, height: h } = platform;
  if (style === 'hex') {
    platform.mesh.visible = false;
    platform.edgeMaterial.opacity = 0;
    const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.98, flatShading: true });
    const radius = Math.min(w, d) * 0.52;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 6, 1), mat);
    shell.castShadow = true; shell.receiveShadow = true;
    platform.group.add(shell);
    addCityWindows(platform.group, radius * 2, radius * 2, h, 6);
    if (r() > 0.45) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.88, 3.6 + r() * 3.5, 6, 1), mat.clone());
      cap.position.y = h * 0.5 + 1.8;
      cap.rotation.y = Math.PI / 6;
      cap.castShadow = true;
      platform.group.add(cap);
    }
    return;
  }

  addCityWindows(platform.group, w, d, h, 4);
  if (style === 'pyramid') {
    const roofMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).multiplyScalar(0.82), roughness: 1, flatShading: true });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.58, 4 + r() * 5, 4, 1), roofMat);
    roof.position.y = h * 0.5 + 2.0;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    platform.group.add(roof);
  } else if (style === 'stepped') {
    const upperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).offsetHSL(0, -0.04, 0.05), roughness: 1, flatShading: true });
    const upper = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, Math.max(2.5, h * 0.28), d * 0.62), upperMat);
    upper.position.y = h * 0.5 + Math.max(1.25, h * 0.14);
    upper.rotation.y = (r() - 0.5) * 0.14;
    upper.castShadow = true;
    platform.group.add(upper);
  } else if (style === 'ruin') {
    const ruinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).offsetHSL(0, 0, 0.06), roughness: 1, flatShading: true });
    const fragment = new THREE.Mesh(new THREE.BoxGeometry(w * (0.35 + r() * 0.3), h * (0.18 + r() * 0.18), d * (0.32 + r() * 0.28)), ruinMat);
    fragment.position.set((r() - 0.5) * w * 0.5, h * 0.5 + h * 0.09, (r() - 0.5) * d * 0.45);
    fragment.rotation.z = (r() - 0.5) * 0.22;
    fragment.castShadow = true;
    platform.group.add(fragment);
  }
}

function buildLevelStructures() {
  if (currentLevel === 'forest') return;
  if (currentLevel === 'city') {
    const cityRandom = mulberry32(74191);
    const placed = [];
    const styles = ['pyramid', 'hex', 'stepped', 'ruin', 'plain'];
    let attempts = 0;
    while (placed.length < 42 && attempts < 700) {
      attempts += 1;
      const x = cityRandom() * (WORLD_SIZE - 52) - (HALF_WORLD - 26);
      const z = cityRandom() * (WORLD_SIZE - 52) - (HALF_WORLD - 26);
      if (Math.hypot(x, z) < 23 || insideInitialPowerupClearing(x, z, 8)) continue;
      const w = 8 + cityRandom() * 13;
      const d = 8 + cityRandom() * 13;
      if (placed.some((b) => wrappedDistanceSquared(x, z, b.x, b.z) < (Math.max(w, d) * 0.65 + b.r + 10) ** 2)) continue;
      const h = 7 + cityRandom() * 27;
      const colour = cityRandom() > 0.48 ? 0x5a3933 : 0x294b49;
      const accent = cityRandom() > 0.5 ? 0xe6815c : 0x72c7b6;
      const platform = addLevelPlatform(x, z, w, d, h, colour, accent);
      const style = styles[Math.floor(cityRandom() * styles.length)];
      decorateCityBuilding(platform, style, colour, accent, 5000 + placed.length * 73);
      placed.push({ x, z, r: Math.max(w, d) * 0.55 });
    }

    // Simple gate remnants and low walls break up the streets without filling every gap.
    for (const [x,z,r] of [[-28,0,0],[31,5,0],[2,-34,Math.PI/2],[-8,39,Math.PI/2],[88,-42,0],[-96,58,Math.PI/2]]) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x63332e, roughness: 1, flatShading: true });
      const g = new THREE.Group();
      for (const sx of [-1,1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 13, 3.2), mat);
        pillar.position.set(sx * 6.0, 6.5, 0); pillar.castShadow = true; g.add(pillar);
        const recess = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x010405 }));
        recess.position.set(sx * 6.0, 6.0, -1.66); g.add(recess);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(15.2, 2.3, 3.2), mat);
      lintel.position.y = 12.0; lintel.rotation.z = 0.045; lintel.castShadow = true; g.add(lintel);
      g.position.set(x, heightAt(x,z), z); g.rotation.y = r; g.userData.collisionSolid = true; scene.add(g);
    }
    return;
  }

  if (currentLevel === 'skyline') {
    const skyRandom = mulberry32(81871);
    const route = [];
    let x = -18, z = 27, heading = -0.35, topHeight = 14;
    for (let i = 0; i < 30; i += 1) {
      const distance = 14 + skyRandom() * 8;
      heading += (skyRandom() - 0.5) * 0.9;
      x = wrapWorld(x + Math.cos(heading) * distance);
      z = wrapWorld(z + Math.sin(heading) * distance);
      topHeight = THREE.MathUtils.clamp(topHeight + (skyRandom() - 0.46) * 15, 10, 72);
      const width = 10.5 + skyRandom() * 5.5;
      const depth = 10.5 + skyRandom() * 5.5;
      route.push({ x, z, topHeight, width, depth });
      if (i % 4 === 2) {
        const side = skyRandom() > 0.5 ? 1 : -1;
        const sideDistance = 12 + skyRandom() * 6;
        route.push({
          x: wrapWorld(x + Math.cos(heading + Math.PI / 2) * sideDistance * side),
          z: wrapWorld(z + Math.sin(heading + Math.PI / 2) * sideDistance * side),
          topHeight: THREE.MathUtils.clamp(topHeight + (skyRandom() - 0.5) * 9, 10, 72),
          width: 10 + skyRandom() * 4,
          depth: 10 + skyRandom() * 4,
        });
      }
    }
    // A second nearby chain gives players alternate routes and more chances to jump between towers.
    for (let i = 0; i < 14; i += 1) {
      const a = i / 14 * TAU + 0.25;
      const radius = 54 + (i % 3) * 12;
      route.push({
        x: Math.cos(a) * radius,
        z: Math.sin(a) * radius,
        topHeight: 18 + (i % 6) * 8,
        width: 11 + (i % 3) * 2,
        depth: 11 + ((i + 1) % 3) * 2,
      });
    }
    route.forEach((t, i) => {
      const ground = heightAt(t.x, t.z);
      const height = Math.max(5.5, t.topHeight - ground);
      addLevelPlatform(t.x, t.z, t.width, t.depth, height, i % 2 ? 0x284e50 : 0x6a3831, i % 3 ? 0x72c8bb : 0xdc805b);
    });
    return;
  }

  if (currentLevel === 'mountains') {
    // The mountain map is intentionally mostly natural. Sparse ruins mark the valley floor,
    // leaving the fixed sharp peaks and broad open basins as the main traversal feature.
    const ruins = [[-36,18,8,8,4],[54,-22,10,7,5],[-72,74,7,9,3.5],[86,92,9,9,4.5]];
    ruins.forEach((t, i) => addLevelPlatform(t[0], t[1], t[2], t[3], t[4], i % 2 ? 0x374a45 : 0x58332e, 0x749f91));
  }
}

function overlapsLevelPlatformXZ(x, z, platform, radius = PLAYER_RADIUS) {
  // Level structures are kept axis-aligned for reliable platforming collisions.
  const dx = Math.max(Math.abs(wrappedDelta(x, platform.x)) - platform.width * 0.5, 0);
  const dz = Math.max(Math.abs(wrappedDelta(z, platform.z)) - platform.depth * 0.5, 0);
  return dx * dx + dz * dz < radius * radius;
}

const NPC_CHATTER = [
  'the path moved again', 'did you hear that tower?', 'leave the bright stones alone',
  'we came from the other side', 'the loop is shorter tonight', 'someone built these stairs',
  'there are lights above us', 'I remember this place differently', 'keep moving', 'not that way',
];

function makeNpcLabel(colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(6.8, 1.28, 1); sprite.position.y = 5.3; sprite.visible = false;
  return { canvas, ctx, texture, sprite, colour };
}

function setNpcChatter(npc, phrase) {
  npc.lastSpeech=phrase;
  const { ctx, texture, colour } = npc.speech;
  ctx.clearRect(0,0,512,96);
  ctx.fillStyle = 'rgba(4,22,24,0.74)'; ctx.fillRect(10,16,492,64);
  ctx.strokeStyle = `#${colour.toString(16).padStart(6,'0')}`; ctx.lineWidth = 3; ctx.strokeRect(10,16,492,64);
  ctx.fillStyle = '#fff1d2'; ctx.font = '700 23px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(phrase.toUpperCase(),256,48);
  texture.needsUpdate = true;
  npc.speech.sprite.visible = true;
  npc.speechUntil = simulationTime + 2.8;
}

function buildNPCSurveyors() {
  const count = currentLevel === 'city' ? 9 : currentLevel === 'skyline' ? 5 : currentLevel === 'mountains' ? 6 : 7;
  const colours = [0x8c69c9,0xc25f86,0x6c7fc9,0xb48545,0x4e936b,0x9b5145,0x5b7280,0xaa7c6a,0x467d91];
  const r = mulberry32(29011 + count * 31 + currentLevel.length * 103);
  for (let i=0;i<count;i+=1) {
    let x = r()*WORLD_SIZE-HALF_WORLD, z = r()*WORLD_SIZE-HALF_WORLD;
    for (let tries=0; tries<80; tries+=1) {
      if (!isBlocked(x,z,heightAt(x,z)) && players.every((p)=>wrappedDistanceSquared(x,z,p.position.x,p.position.z)>18*18)) break;
      x = r()*WORLD_SIZE-HALF_WORLD; z = r()*WORLD_SIZE-HALF_WORLD;
    }
    const colour = colours[i % colours.length];
    const darkColour = new THREE.Color(colour).multiplyScalar(0.5).getHex();
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.95,2.9,5,1), new THREE.MeshStandardMaterial({color:colour,roughness:1,flatShading:true}));
    body.position.y=2.05; body.rotation.y=0.2;
    const hood = new THREE.Mesh(new THREE.OctahedronGeometry(0.72,0), new THREE.MeshStandardMaterial({color:darkColour,roughness:1,flatShading:true}));
    hood.position.y=3.62; hood.scale.set(0.9,1.15,0.85);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.48,0.25,0.08), new THREE.MeshBasicMaterial({color:0x071719}));
    face.position.set(0,3.58,-0.62);
    const legs=[];
    for (const side of [-1,1]) {
      const pivot=new THREE.Group(); pivot.position.set(side*0.28,1.0,0);
      const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.01,1.35,3,1),new THREE.MeshStandardMaterial({color:darkColour,roughness:1,flatShading:true}));
      leg.position.y=-0.64; pivot.add(leg); root.add(pivot); legs.push(pivot);
    }
    const speech=makeNpcLabel(colour); root.add(body,hood,face,speech.sprite);
    root.traverse((o)=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    scene.add(root);
    npcVisuals.push({root,body,legs,speech,x,z,y:heightAt(x,z),yaw:r()*TAU,targetYaw:r()*TAU,speed:2.1+r()*2.2,walkPhase:r()*TAU,turnAt:simulationTime+2+r()*5,nextChat:simulationTime+4+r()*12,speechUntil:0,phraseIndex:i,verticalVelocity:0,airborne:false});
  }
}

function updateNPCSurveyors(delta) {
  for (const npc of npcVisuals) {
    if (simulationTime >= npc.turnAt && !npc.airborne) {
      npc.targetYaw += (random()-0.5)*2.4;
      npc.turnAt = simulationTime + 2.5 + random()*5.5;
    }
    const deltaYaw = THREE.MathUtils.euclideanModulo(npc.targetYaw - npc.yaw + Math.PI, TAU) - Math.PI;
    npc.yaw += THREE.MathUtils.clamp(deltaYaw, -delta*1.2, delta*1.2);

    // Airborne NPCs keep a little horizontal momentum but are governed by gravity until landing.
    const movementScale = npc.airborne ? 0.32 : 1;
    const dx=-Math.sin(npc.yaw)*npc.speed*delta*movementScale, dz=-Math.cos(npc.yaw)*npc.speed*delta*movementScale;
    const nx=wrapWorld(npc.x+dx), nz=wrapWorld(npc.z+dz);
    const blockedByLevel = levelPlatforms.some((platform) => overlapsLevelPlatformXZ(nx, nz, platform, 0.5) && heightAt(nx,nz) < platform.top && npc.y < platform.top + 0.4);
    if (!isBlocked(nx,nz,heightAt(nx,nz)) && !blockedByLevel) { npc.x=nx; npc.z=nz; npc.walkPhase += npc.speed*delta*1.6*movementScale; }
    else if (!npc.airborne) { npc.targetYaw += Math.PI*(0.55+random()*0.5); npc.turnAt=simulationTime+0.8; }

    const floor = heightAt(npc.x,npc.z);
    if (npc.airborne || npc.verticalVelocity > 0.01) {
      npc.verticalVelocity -= 23 * delta;
      npc.y += npc.verticalVelocity * delta;
      if (npc.y <= floor) {
        npc.y = floor;
        npc.verticalVelocity = 0;
        npc.airborne = false;
      }
    } else {
      npc.y = floor;
    }

    npc.legs[0].rotation.x=npc.airborne ? 0.28 : Math.sin(npc.walkPhase)*0.32;
    npc.legs[1].rotation.x=npc.airborne ? -0.22 : -Math.sin(npc.walkPhase)*0.32;
    npc.body.rotation.z=Math.sin(simulationTime*0.7+npc.phraseIndex)*0.02 + (npc.airborne ? 0.08 : 0);
    if (npc.speechUntil < simulationTime) npc.speech.sprite.visible=false;
    if (simulationTime >= npc.nextChat) {
      const near = players.some((p)=>wrappedDistanceSquared(npc.x,npc.z,p.position.x,p.position.z)<55*55);
      if (near) {
        const phrase=NPC_CHATTER[npc.phraseIndex++ % NPC_CHATTER.length];
        setNpcChatter(npc,phrase);
        audioEngine.playNpcChatter?.(npc.phraseIndex);
      }
      npc.nextChat=simulationTime+7+random()*12;
    }
  }
}

function createEchoPrototype(material) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.65, 0), material);
  core.castShadow = true;
  group.add(core);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: palette.cream,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.08, 4, 24), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.userData.isEchoRing = true;
  group.add(ring);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.28, 22, 5, 1, true),
    new THREE.MeshBasicMaterial({
      color: palette.ember,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 10.5;
  group.add(beam);
  return group;
}

function buildEchoes() {
  echoDefs.forEach((echo, echoIndex) => {
    const material = new THREE.MeshStandardMaterial({
      color: palette.cream,
      emissive: palette.ember,
      emissiveIntensity: 2.6,
      roughness: 0.56,
      flatShading: true,
    });
    const prototype = createEchoPrototype(material);
    const marker = prototype.clone(true);
    marker.position.set(echo.x, heightAt(echo.x, echo.z) + 4.6, echo.z);
    marker.userData.baseX = echo.x;
    marker.userData.baseZ = echo.z;
    marker.userData.phase = echoIndex * 1.17;
    marker.userData.echoIndex = echoIndex;
    scene.add(marker);
    echoVisuals.push({ material, copies: [marker] });
  });
}

function buildSky() {
  skyAnchor = new THREE.Group();
  scene.add(skyAnchor);

  const moon = new THREE.Mesh(
    new THREE.IcosahedronGeometry(23, 2),
    new THREE.MeshBasicMaterial({ color: 0xffd79a, fog: false }),
  );
  moon.position.set(176, 190, -360);
  moon.scale.set(1, 1.06, 1);
  skyAnchor.add(moon);

  const starCount = 280;
  const positions = new Float32Array(starCount * 3);
  const starRandom = mulberry32(1309);
  for (let i = 0; i < starCount; i += 1) {
    const angle = starRandom() * TAU;
    const radius = 340 + starRandom() * 175;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 68 + starRandom() * 265;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xfff0c9, size: 1.15, sizeAttenuation: true, fog: false }),
  );
  skyAnchor.add(stars);

  const skyRandom = mulberry32(61123);
  for (let i = 0; i < 7; i += 1) {
    const group = new THREE.Group();
    const glow = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.1 + skyRandom() * 0.9, 0),
      new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xffc47d : 0x9cf6ff,
        transparent: true,
        opacity: 0.72,
        fog: false,
      }),
    );
    const trail = new THREE.Mesh(
      new THREE.BoxGeometry(14 + skyRandom() * 7, 0.42, 0.42),
      new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xffa35d : 0x6be5ff,
        transparent: true,
        opacity: 0.18,
        fog: false,
      }),
    );
    trail.position.x = -(6 + skyRandom() * 4);
    group.add(trail, glow);
    skyAnchor.add(group);
    skyLightVisuals.push({
      group,
      glow,
      radius: 250 + skyRandom() * 210,
      height: 118 + skyRandom() * 105,
      speed: 0.016 + skyRandom() * 0.02,
      phase: skyRandom() * TAU,
      wobble: 5 + skyRandom() * 11,
      stretch: 0.66 + skyRandom() * 0.3,
    });
  }
}

function buildMotes() {
  const count = 240;
  const positions = new Float32Array(count * 3);
  const moteRandom = mulberry32(49117);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (moteRandom() - 0.5) * 155;
    positions[i * 3 + 1] = moteRandom() * 43 - 5;
    positions[i * 3 + 2] = (moteRandom() - 0.5) * 155;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  motes = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xff9b5c,
      size: 0.34,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    }),
  );
  scene.add(motes);
}

function buildFireflies() {
  fireflySwarm = new THREE.Group();
  scene.add(fireflySwarm);

  const swarmRandom = mulberry32(29291);
  for (let i = 0; i < 42; i += 1) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.13 + swarmRandom() * 0.08, 0),
      new THREE.MeshBasicMaterial({
        color: swarmRandom() > 0.48 ? 0xffd77b : 0x98ffd9,
        transparent: true,
        opacity: 0.9,
      }),
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.22 + swarmRandom() * 0.12, 5, 4),
      new THREE.MeshBasicMaterial({
        color: 0xffbe72,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    group.add(halo, core);
    fireflySwarm.add(group);
    fireflyVisuals.push({
      group,
      orbit: 9 + swarmRandom() * 72,
      altitude: 0.55 + swarmRandom() * 8.8,
      speed: 0.11 + swarmRandom() * 0.29,
      bobSpeed: 0.8 + swarmRandom() * 1.5,
      phase: swarmRandom() * TAU,
      wander: 0.7 + swarmRandom() * 2.3,
      size: 0.84 + swarmRandom() * 0.7,
    });
  }
}

function towerLocalXZ(x, z, towerIndex) {
  const building = buildingDefs[towerIndex];
  const dx = wrappedDelta(x, building.x);
  const dz = wrappedDelta(z, building.z);
  const c = Math.cos(building.rotation);
  const s = Math.sin(building.rotation);
  return {
    x: dx * c - dz * s,
    z: dx * s + dz * c,
  };
}

function towerBaseY(towerIndex) {
  const building = buildingDefs[towerIndex];
  return heightAt(building.x, building.z) - 0.2;
}

function towerTopY(towerIndex) {
  const building = buildingDefs[towerIndex];
  return towerBaseY(towerIndex) + 73.5 * building.scale;
}

function towerLowerRoofY(towerIndex) {
  const building = buildingDefs[towerIndex];
  return towerBaseY(towerIndex) + 47.5 * building.scale;
}

function insideTowerRect(x, z, towerIndex, halfXLocal, halfZLocal, padding = 0) {
  const building = buildingDefs[towerIndex];
  const local = towerLocalXZ(x, z, towerIndex);
  return Math.abs(local.x) <= halfXLocal * building.scale + padding &&
    Math.abs(local.z) <= halfZLocal * building.scale + padding;
}

function towerVolumeBlocksPlayer(x, z, feet, towerIndex, radius = PLAYER_RADIUS, height = PLAYER_HEIGHT) {
  const building = buildingDefs[towerIndex];
  const base = towerBaseY(towerIndex);
  const top = feet + height;
  const overlapsY = (minLocalY, maxLocalY) => {
    const minY = base + minLocalY * building.scale;
    const maxY = base + maxLocalY * building.scale;
    return feet < maxY - 0.035 && top > minY + 0.035;
  };
  if (insideTowerRect(x, z, towerIndex, 5.5, 5.5, radius) && overlapsY(0, 43)) return true;
  if (insideTowerRect(x, z, towerIndex, 23.5, 21.5, radius) && overlapsY(39, 47.5)) return true;
  if (insideTowerRect(x, z, towerIndex, 22, 20, radius) && overlapsY(47.5, 73.5)) return true;
  return false;
}

function towerFloorCrossed(x, z, oldFeet, newFeet, radius = PLAYER_RADIUS) {
  let floor = -Infinity;
  buildingDefs.forEach((building, towerIndex) => {
    const topY = towerTopY(towerIndex);
    if (insideTowerRect(x, z, towerIndex, 22, 20, Math.max(0.05, radius - 0.05)) &&
        oldFeet >= topY - 0.075 && newFeet <= topY + 0.025) {
      floor = Math.max(floor, topY);
      return;
    }
    const lowerY = towerLowerRoofY(towerIndex);
    const onWideSlab = insideTowerRect(x, z, towerIndex, 23.5, 21.5, Math.max(0.05, radius - 0.05));
    const insideUpper = insideTowerRect(x, z, towerIndex, 22, 20, radius + 0.02);
    if (onWideSlab && !insideUpper && oldFeet >= lowerY - 0.075 && newFeet <= lowerY + 0.025) {
      floor = Math.max(floor, lowerY);
    }
  });
  return floor;
}

function towerCeilingCrossed(x, z, oldTop, newTop, radius = PLAYER_RADIUS) {
  let ceiling = Infinity;
  buildingDefs.forEach((building, towerIndex) => {
    const base = towerBaseY(towerIndex);
    const surfaces = [
      { y: base + 39 * building.scale, halfX: 23.5, halfZ: 21.5 },
      { y: base + 47.5 * building.scale, halfX: 22, halfZ: 20 },
    ];
    for (const surface of surfaces) {
      if (!insideTowerRect(x, z, towerIndex, surface.halfX, surface.halfZ, Math.max(0.04, radius - 0.08))) continue;
      if (oldTop <= surface.y + 0.04 && newTop >= surface.y) ceiling = Math.min(ceiling, surface.y);
    }
  });
  return ceiling;
}

function towerTopIndexAt(x, z, feet, tolerance = 0.18, radius = PLAYER_RADIUS) {
  for (let i = 0; i < buildingDefs.length; i += 1) {
    const topY = towerTopY(i);
    if (Math.abs(feet - topY) <= tolerance && insideTowerRect(x, z, i, 22, 20, Math.max(0.04, radius - 0.08))) return i;
  }
  return -1;
}

function isBlocked(x, z, feet = -Infinity, radius = PLAYER_RADIUS, height = PLAYER_HEIGHT) {
  for (const tree of treeColliders) {
    const limit = tree.radius + radius + 0.10;
    if (wrappedDistanceSquared(x, z, tree.x, tree.z) < limit * limit) return true;
  }
  for (const structure of structureColliders) {
    if (structure.kind === 'tower') {
      if (Number.isFinite(feet) && towerVolumeBlocksPlayer(x, z, feet, structure.towerIndex, radius, height)) return true;
      if (!Number.isFinite(feet)) {
        const limit = structure.radius + radius + 0.20;
        if (wrappedDistanceSquared(x, z, structure.x, structure.z) < limit * limit) return true;
      }
      continue;
    }
    const limit = structure.radius + radius + 0.20;
    if (wrappedDistanceSquared(x, z, structure.x, structure.z) < limit * limit) return true;
  }
  return false;
}

function wrapCoordinate(value) {
  if (value > HALF_WORLD) return { value: value - WORLD_SIZE, crossed: true };
  if (value < -HALF_WORLD) return { value: value + WORLD_SIZE, crossed: true };
  return { value, crossed: false };
}

function applyStickDeadzone(value, deadzone = 0.16) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone));
}

function gamepadForAssignment(assignment) {
  if (!assignment.startsWith('gamepad-')) return null;
  const index = Number(assignment.slice(8));
  const pad = safeGamepads()[index];
  return pad?.connected === false ? null : pad || null;
}

function keyboardPlayerIndex() {
  return inputAssignments.findIndex((assignment) => assignment === 'keyboard');
}

function inputForPlayer(playerIndex, delta) {
  const assignment = inputAssignments[playerIndex];
  if (assignment === 'keyboard') {
    return {
      forward: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
      side: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
      sprint: Boolean(keys.ShiftLeft || keys.ShiftRight),
    };
  }
  if (assignment === 'touch') {
    const touch = touchControls[playerIndex];
    return { forward: touch.moveForward, side: touch.moveSide, sprint: touch.sprint };
  }
  const pad = gamepadForAssignment(assignment);
  if (!pad) { gamepadButtonState[playerIndex] = []; return { forward: 0, side: 0, sprint: false }; }
  const p = players[playerIndex];
  p.yaw -= applyStickDeadzone(pad.axes[2] || 0, 0.14) * 2.65 * delta;
  p.pitch = THREE.MathUtils.clamp(p.pitch - applyStickDeadzone(pad.axes[3] || 0, 0.14) * 2.65 * 0.82 * delta, -1.42, 1.38);
  const previous = gamepadButtonState[playerIndex];
  const pressed = (i) => Boolean(pad.buttons[i]?.pressed && !previous[i]);
  const throwHeld = Boolean(pad.buttons[5]?.pressed);
  const result = {
    forward: -applyStickDeadzone(pad.axes[1] || 0),
    side: applyStickDeadzone(pad.axes[0] || 0),
    sprint: Boolean(pad.buttons[4]?.pressed || pad.buttons[10]?.pressed || (pad.buttons[7]?.value || 0) > 0.6),
    jumpPressed: pressed(0), placePressed: pressed(2), toggleBuildPressed: pressed(3),
    throwPressed: throwHeld && !previous[5], throwReleased: !throwHeld && Boolean(previous[5]), throwHeld,
  };
  gamepadButtonState[playerIndex] = pad.buttons.map((b) => b.pressed);
  return result;
}

function clearanceAt(x, z, feet, ignore = null, p = null) {
  const radius = p ? playerRadius(p) : PLAYER_RADIUS;
  const height = p ? playerHeight(p) : PLAYER_HEIGHT;
  const tempClear = temporaryBlocks.every((b) => b === ignore || !overlapsBlockXZ(x, z, b, radius) ||
    feet >= b.top - 0.035 || feet + height <= b.bottom + 0.035);
  if (!tempClear) return false;
  return levelPlatforms.every((platform) => !overlapsLevelPlatformXZ(x, z, platform, radius) ||
    feet >= platform.top - 0.035 || feet + height <= platform.bottom + 0.035);
}

function movePlayerAxis(p, axis, amount) {
  if (Math.abs(amount) < 1e-9) return { moved: 0, crossed: false };
  const old = p.position[axis];
  const wrapped = wrapCoordinate(old + amount);
  const x = axis === 'x' ? wrapped.value : p.position.x;
  const z = axis === 'z' ? wrapped.value : p.position.z;
  const eye = playerEyeHeight(p), height = playerHeight(p), radius = playerRadius(p), stepHeight = playerStepHeight(p);
  const feet = p.position.y - eye;
  if (isBlocked(x, z, feet, radius, height)) return { moved: 0, crossed: false };
  let stepFeet = feet;
  for (const b of temporaryBlocks) {
    if (!overlapsBlockXZ(x, z, b, radius)) continue;
    if (feet >= b.top - 0.035 || feet + height <= b.bottom + 0.035) continue;
    const rise = b.top - feet;
    if (p.grounded && p.verticalVelocity <= 0 && rise <= stepHeight) stepFeet = Math.max(stepFeet, b.top);
    else return { moved: 0, crossed: false };
  }
  for (const platform of levelPlatforms) {
    if (!overlapsLevelPlatformXZ(x, z, platform, radius)) continue;
    if (feet >= platform.top - 0.035 || feet + height <= platform.bottom + 0.035) continue;
    const rise = platform.top - feet;
    if (p.grounded && p.verticalVelocity <= 0 && rise <= stepHeight) stepFeet = Math.max(stepFeet, platform.top);
    else return { moved: 0, crossed: false };
  }
  if (stepFeet > feet && !clearanceAt(x, z, stepFeet, null, p)) return { moved: 0, crossed: false };
  p.position[axis] = wrapped.value;
  if (stepFeet > feet) {
    p.position.y = stepFeet + eye;
    p.stepViewOffset = Math.max(-1.0, p.stepViewOffset - (stepFeet - feet));
    p.lastGroundHeight = stepFeet;
  }
  return { moved: Math.abs(wrappedDelta(wrapped.value, old)), crossed: wrapped.crossed };
}

function updatePlayer(delta, playerIndex) {
  if (!gameIsActive()) return;
  const p = players[playerIndex];
  syncPlayerScale(p);
  const eye = playerEyeHeight(p), bodyHeight = playerHeight(p), bodyRadius = playerRadius(p);
  const input = inputForPlayer(playerIndex, delta);
  const movingIntent = Math.hypot(input.forward || 0, input.side || 0) > 0.18;
  p.isRunning = Boolean(input.sprint && movingIntent);
  if (input.toggleBuildPressed) toggleBuild(playerIndex);
  if (input.placePressed) placeBlock(playerIndex);
  if (input.throwPressed) beginThrowCharge(playerIndex, 'gamepad');
  if (input.throwReleased) releaseThrowCharge(playerIndex);
  if (input.jumpPressed) p.jumpRequested = true;
  const flyActive = playerHasPower(p, 'fly');
  const jumpVelocity = playerHasPower(p, 'jump') ? 66 : 9.2;
  if (p.jumpRequested) {
    if (flyActive) {
      p.verticalVelocity = Math.max(p.verticalVelocity, playerHasPower(p, 'jump') ? 34 : 10.8);
      p.grounded = false;
    } else if (p.grounded) {
      p.verticalVelocity = jumpVelocity;
      p.grounded = false;
    }
  }
  p.jumpRequested = false;
  const forward = THREE.MathUtils.clamp(input.forward, -1, 1);
  const side = THREE.MathUtils.clamp(input.side, -1, 1);
  const length = Math.max(1, Math.hypot(forward, side));
  const speedBoost = playerHasPower(p, 'speed') ? 1.75 : 1;
  const speed = (input.sprint ? 21.5 : 12.2) * speedBoost;
  const vx = (-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * side) * speed / length;
  const vz = (-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * side) * speed / length;
  const steps = Math.max(1, Math.ceil(delta / (1 / 120)));
  const dt = delta / steps;
  let travelled = 0;
  let crossed = false;
  for (let n = 0; n < steps; n++) {
    const mx = movePlayerAxis(p, 'x', vx * dt);
    const mz = movePlayerAxis(p, 'z', vz * dt);
    crossed ||= mx.crossed || mz.crossed;
    travelled += Math.hypot(mx.moved, mz.moved);
    const oldFeet = p.position.y - eye;
    p.verticalVelocity -= (flyActive ? 6.4 : 24) * dt;
    if (flyActive) p.verticalVelocity = Math.max(p.verticalVelocity, -4.2);
    let newFeet = oldFeet + p.verticalVelocity * dt;
    if (p.verticalVelocity > 0) {
      for (const b of temporaryBlocks) {
        if (overlapsBlockXZ(p.position.x, p.position.z, b, bodyRadius) && oldFeet + bodyHeight <= b.bottom + 0.04 &&
            newFeet + bodyHeight >= b.bottom) {
          newFeet = Math.min(newFeet, b.bottom - bodyHeight);
          p.verticalVelocity = 0;
        }
      }
      for (const platform of levelPlatforms) {
        if (overlapsLevelPlatformXZ(p.position.x, p.position.z, platform, bodyRadius) && oldFeet + bodyHeight <= platform.bottom + 0.04 &&
            newFeet + bodyHeight >= platform.bottom) {
          newFeet = Math.min(newFeet, platform.bottom - bodyHeight);
          p.verticalVelocity = 0;
        }
      }
      const towerCeiling = towerCeilingCrossed(
        p.position.x,
        p.position.z,
        oldFeet + bodyHeight,
        newFeet + bodyHeight,
        bodyRadius,
      );
      if (Number.isFinite(towerCeiling)) {
        newFeet = Math.min(newFeet, towerCeiling - bodyHeight);
        p.verticalVelocity = 0;
      }
    }
    let floor = heightAt(p.position.x, p.position.z);
    if (p.verticalVelocity <= 0) {
      for (const b of temporaryBlocks) {
        if (overlapsBlockXZ(p.position.x, p.position.z, b, Math.max(0.03, bodyRadius - 0.02)) &&
            oldFeet >= b.top - 0.055 && newFeet <= b.top + 0.015) floor = Math.max(floor, b.top);
      }
      for (const platform of levelPlatforms) {
        if (overlapsLevelPlatformXZ(p.position.x, p.position.z, platform, Math.max(0.03, bodyRadius - 0.02)) &&
            oldFeet >= platform.top - 0.055 && newFeet <= platform.top + 0.015) floor = Math.max(floor, platform.top);
      }
      floor = Math.max(floor, towerFloorCrossed(p.position.x, p.position.z, oldFeet, newFeet, bodyRadius));
    }
    if (newFeet <= floor + 0.002) {
      newFeet = floor; p.verticalVelocity = 0; p.grounded = true; p.lastGroundHeight = floor;
    } else p.grounded = false;
    p.position.y = newFeet + eye;
  }
  p.distance += travelled;
  p.walkPhase += travelled * 1.65;
  const amount = THREE.MathUtils.clamp(travelled / Math.max(delta * 12.2, 0.001), 0, 1);
  p.walkAmount = THREE.MathUtils.damp(p.walkAmount || 0, amount, 15, delta);
  if (crossed) {
    p.loop++;
    showSignal(`Player ${playerIndex + 1}: the horizon folds quietly behind you.`);
    audioEngine.playLoopTone();
  }
  if (travelled > 0) checkEchoes(p, playerIndex);
}

function updateTowerRoofEffects(delta) {
  const activationColours = [0x52ffd0, 0xb47aff, 0xffcf68, 0x68bfff, 0xff6fae];
  players.forEach((p, playerIndex) => {
    const feet = p.position.y - playerEyeHeight(p);
    const towerIndex = towerTopIndexAt(p.position.x, p.position.z, feet, 0.18, playerRadius(p));
    if (towerIndex >= 0) towerStates[towerIndex].activeUntil = Math.max(towerStates[towerIndex].activeUntil, simulationTime + 7.5);
    if (towerIndex !== p.towerRoofIndex) {
      if (towerIndex >= 0) {
        showSignal(`PLAYER ${playerIndex + 1}: TOWER ${String(towerIndex + 1).padStart(2, '0')} AWAKENS`, 3400);
        audioEngine.playTowerAwakening(towerIndex);
      }
      p.towerRoofIndex = towerIndex;
    }
  });

  towerStates.forEach((state, index) => {
    const target = state.activeUntil > simulationTime ? 1 : 0;
    state.energy = THREE.MathUtils.damp(state.energy, target, target ? 4.2 : 1.1, delta);
    const visual = towerVisuals[index];
    if (!visual) return;
    const colour = new THREE.Color(activationColours[index % activationColours.length]);
    const shimmer = state.energy * (0.88 + Math.sin(simulationTime * 2.15 + index * 1.7) * 0.12);
    visual.materials.forEach((record) => {
      const { material, baseColor, baseEmissive, baseEmissiveIntensity } = record;
      if (baseColor && material.color) material.color.copy(baseColor).lerp(colour, shimmer * 0.42);
      if (baseEmissive && material.emissive) {
        material.emissive.copy(baseEmissive).lerp(colour, shimmer * 0.62);
        material.emissiveIntensity = baseEmissiveIntensity + shimmer * 1.35;
      }
    });
  });
}


function updateWorld(time) {
  audioEngine.updateTowerAmbience();

  for (const skyLight of skyLightVisuals) {
    const drift = time * skyLight.speed + skyLight.phase;
    const x = Math.cos(drift) * skyLight.radius;
    const z = Math.sin(drift) * skyLight.radius * skyLight.stretch;
    const y = skyLight.height + Math.sin(time * 0.07 + skyLight.phase) * skyLight.wobble;
    skyLight.group.position.set(x, y, z);
    skyLight.group.rotation.y = drift + Math.PI * 0.5;
    skyLight.group.rotation.z = Math.sin(time * 0.09 + skyLight.phase) * 0.18;
    const pulse = 0.9 + Math.sin(time * 0.65 + skyLight.phase) * 0.12;
    skyLight.glow.scale.setScalar(pulse);
  }

  motes.rotation.y = time * 0.006;
}

function prepareWorldForPlayer(viewPlayer, time) {
  skyAnchor.position.set(viewPlayer.position.x, 0, viewPlayer.position.z);
  motes.position.set(viewPlayer.position.x, viewPlayer.position.y - EYE_HEIGHT, viewPlayer.position.z);

  sun.position.set(viewPlayer.position.x + 52, viewPlayer.position.y + 92, viewPlayer.position.z + 34);
  sunTarget.position.set(viewPlayer.position.x, viewPlayer.position.y - 10, viewPlayer.position.z);
  sunTarget.updateMatrixWorld();

  for (const structure of animatedStructures) {
    const baseX = viewPlayer.position.x + wrappedDelta(structure.userData.baseX, viewPlayer.position.x);
    const baseZ = viewPlayer.position.z + wrappedDelta(structure.userData.baseZ, viewPlayer.position.z);
    structure.position.set(baseX, heightAt(structure.userData.baseX, structure.userData.baseZ) + structure.userData.yOffset, baseZ);
    structure.rotation.set(0, structure.userData.baseRotation, 0);

  }

  const baseFireflyY = viewPlayer.position.y - EYE_HEIGHT;
  for (const firefly of fireflyVisuals) {
    const orbit = time * firefly.speed + firefly.phase;
    const x = viewPlayer.position.x + Math.cos(orbit) * firefly.orbit + Math.sin(orbit * 2.3) * firefly.wander;
    const z = viewPlayer.position.z + Math.sin(orbit * 1.1) * firefly.orbit + Math.cos(orbit * 1.7) * firefly.wander;
    const y = baseFireflyY + firefly.altitude + Math.sin(time * firefly.bobSpeed + firefly.phase) * 0.72;
    firefly.group.position.set(x, y, z);
    const pulse = firefly.size * (0.9 + Math.sin(time * 2.7 + firefly.phase) * 0.12);
    firefly.group.scale.setScalar(pulse);
  }

  echoVisuals.forEach((visual, echoIndex) => {
    const found = discoveredEchoes.has(echoIndex);
    for (const marker of visual.copies) {
      const x = viewPlayer.position.x + wrappedDelta(marker.userData.baseX, viewPlayer.position.x);
      const z = viewPlayer.position.z + wrappedDelta(marker.userData.baseZ, viewPlayer.position.z);
      marker.position.x = x;
      marker.position.z = z;
      marker.position.y = heightAt(x, z) + 4.6 + Math.sin(time * 1.15 + marker.userData.phase) * 0.42;
      marker.rotation.y = time * (found ? 0.18 : 0.48) + marker.userData.phase;
      const ring = marker.children.find((child) => child.userData.isEchoRing);
      if (ring) {
        const pulse = 1 + Math.sin(time * 2.1 + marker.userData.phase) * (found ? 0.025 : 0.1);
        ring.scale.setScalar(pulse);
      }
    }
  });
}

function checkEchoes(viewPlayer, playerIndex) {
  echoDefs.forEach((echo, index) => {
    if (discoveredEchoes.has(index)) return;
    if (wrappedDistanceSquared(viewPlayer.position.x, viewPlayer.position.z, echo.x, echo.z) > 9.2 ** 2) return;

    discoveredEchoes.add(index);
    const visual = echoVisuals[index];
    visual.material.color.setHex(0x27645b);
    visual.material.emissive.setHex(0x0d5a50);
    visual.material.emissiveIntensity = 0.52;
    ui.echoCount.textContent = `${String(discoveredEchoes.size).padStart(2, '0')} / 06`;
    showSignal(`Player ${playerIndex + 1}: ${echo.text}`, 6200);
    audioEngine.playEcho(index);

    if (discoveredEchoes.size === echoDefs.length) {
      window.setTimeout(() => {
        showSignal('Survey complete. The path has begun again.', 8500);
        audioEngine.playCompletion();
      }, 6800);
    }
  });
}

function showSignal(text, duration = 4400) {
  window.clearTimeout(signalTimer);
  ui.signalText.textContent = text;
  ui.signal.classList.add('visible');
  signalTimer = window.setTimeout(() => ui.signal.classList.remove('visible'), duration);
}

function inputLabel(assignment) {
  if (assignment === 'keyboard') return 'KEYBOARD + MOUSE';
  if (assignment === 'gamepad-0') return 'GAMEPAD 1';
  if (assignment.startsWith('gamepad-')) return `GAMEPAD ${Number(assignment.slice(8)) + 1}`;
  if (assignment === 'touch') return 'TOUCHSCREEN';
  return assignment.toUpperCase();
}

function updateReadouts() {
  const p1 = players[0];
  const p2 = players[1];
  const x = Math.round(p1.position.x + HALF_WORLD);
  const z = Math.round(p1.position.z + HALF_WORLD);
  ui.coordinates.textContent = `P1 ${String(x).padStart(3, '0')} · ${String(z).padStart(3, '0')}`;
  ui.distance.textContent = `P1 ${Math.floor(p1.distance)}m · P2 ${Math.floor(p2.distance)}m`;
  ui.loops.textContent = `P1 ${String(p1.loop).padStart(2, '0')} · P2 ${String(p2.loop).padStart(2, '0')}`;
  if (vehicleModeActive()) {
    const s1=vehicleStates[0], s2=vehicleStates[1];
    ui.coordinates.textContent = currentGameMode === 'race' ? `RACE · ${RACE_LAPS} LAPS` : 'FREE FLY';
    ui.distance.textContent = `P1 ${Math.round(s1.speed)} · P2 ${Math.round(s2.speed)}`;
    ui.loops.textContent = currentGameMode === 'race' ? `P1 L${Math.min(s1.lap,RACE_LAPS)} · P2 L${Math.min(s2.lap,RACE_LAPS)}` : 'FLIGHT ACTIVE';
    const v1=vehiclePowerSummary(s1), v2=vehiclePowerSummary(s2);
    ui.player1Label.innerHTML = `<strong>PLAYER 1</strong><span>${inputLabel(inputAssignments[0])}</span><br /><span>${Math.round(s1.speed)} SPEED${currentGameMode==='race'?` · ${raceCheckpointStatus(s1)}`:''}</span>${v1?`<br /><span>${v1}</span>`:''}`;
    ui.player2Label.innerHTML = `<strong>PLAYER 2</strong><span>${inputLabel(inputAssignments[1])}</span><br /><span>${Math.round(s2.speed)} SPEED${currentGameMode==='race'?` · ${raceCheckpointStatus(s2)}`:''}</span>${v2?`<br /><span>${v2}</span>`:''}`;
    return;
  }
  const p1Powers = activePowerSummary(p1);
  const p2Powers = activePowerSummary(p2);
  ui.player1Label.innerHTML = `<strong>PLAYER 1</strong><span>${inputLabel(inputAssignments[0])}</span><br /><span>LOOP ${String(p1.loop).padStart(2, '0')}</span>${p1Powers ? `<br /><span>${p1Powers}</span>` : ''}`;
  ui.player2Label.innerHTML = `<strong>PLAYER 2</strong><span>${inputLabel(inputAssignments[1])}</span><br /><span>LOOP ${String(p2.loop).padStart(2, '0')}</span>${p2Powers ? `<br /><span>${p2Powers}</span>` : ''}`;
}

const audioEngine = {
  context: null,
  master: null,
  muted: false,
  interval: 0,
  step: 0,
  nodes: [],
  towerAmbiences: [],
  entryTonePlayed: false,
  towerConfigs: [
    {
      name: 'Glass Choir',
      root: 73.42,
      droneRatios: [1, 1.5, 2.25],
      droneTypes: ['sine', 'triangle', 'sine'],
      droneLevels: [0.09, 0.052, 0.026],
      pattern: [0, 7, 12, 16, 12, 7],
      noteType: 'sine',
      phraseEvery: 4200,
      noteSpacing: 0.56,
      noteLength: 3.6,
      filter: 1250,
      filterQ: 1.1,
      maxGain: 0.78,
      pan: 0.25,
    },
    {
      name: 'Buried Pulse',
      root: 51.91,
      droneRatios: [1, 2, 3.02],
      droneTypes: ['sawtooth', 'triangle', 'sine'],
      droneLevels: [0.052, 0.043, 0.018],
      pattern: [0, 3, 10, 5, 3, -2],
      noteType: 'triangle',
      phraseEvery: 5100,
      noteSpacing: 0.72,
      noteLength: 2.8,
      filter: 560,
      filterQ: 2.4,
      maxGain: 0.82,
      pan: -0.3,
    },
    {
      name: 'Suspended Field',
      root: 87.31,
      droneRatios: [1, 1.333, 1.997],
      droneTypes: ['triangle', 'sine', 'sine'],
      droneLevels: [0.061, 0.038, 0.024],
      pattern: [0, 5, 9, 14, 9, 5, 2],
      noteType: 'sine',
      phraseEvery: 3350,
      noteSpacing: 0.38,
      noteLength: 4.4,
      filter: 1680,
      filterQ: 0.75,
      maxGain: 0.72,
      pan: 0.42,
    },
    {
      name: 'Cold Organ',
      root: 61.74,
      droneRatios: [1, 1.414, 2.378],
      droneTypes: ['sine', 'square', 'triangle'],
      droneLevels: [0.074, 0.016, 0.031],
      pattern: [0, 6, 1, 8, 13, 6],
      noteType: 'triangle',
      phraseEvery: 5900,
      noteSpacing: 0.84,
      noteLength: 5.2,
      filter: 740,
      filterQ: 3.1,
      maxGain: 0.77,
      pan: -0.16,
    },
    {
      name: 'Vermilion Signal',
      root: 65.41,
      droneRatios: [1, 1.25, 1.875],
      droneTypes: ['triangle', 'sine', 'sawtooth'],
      droneLevels: [0.066, 0.037, 0.019],
      pattern: [0, 2, 7, 11, 14, 7, 2],
      noteType: 'sine',
      phraseEvery: 3850,
      noteSpacing: 0.47,
      noteLength: 3.9,
      filter: 980,
      filterQ: 1.8,
      maxGain: 0.8,
      pan: 0.05,
    },
  ],

  start() {
    if (this.context) {
      this.context.resume();
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      ui.sound.textContent = 'SOUND UNAVAILABLE';
      ui.sound.disabled = true;
      return;
    }

    this.context = new AudioContext();
    const now = this.context.currentTime;
    this.master = this.context.createGain();
    this.master.gain.setValueAtTime(0.0001, now);
    this.master.gain.exponentialRampToValueAtTime(0.38, now + 1.35);

    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.03;
    compressor.release.value = 0.55;
    this.master.connect(compressor).connect(this.context.destination);

    const reverb = this.context.createConvolver();
    reverb.buffer = this.createImpulse(4.2, 3.2);
    const reverbGain = this.context.createGain();
    reverbGain.gain.value = 0.52;
    reverb.connect(reverbGain).connect(this.master);

    const dry = this.context.createGain();
    dry.gain.value = 0.78;
    dry.connect(this.master);

    const droneFilter = this.context.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 420;
    droneFilter.Q.value = 1.8;
    droneFilter.connect(dry);
    droneFilter.connect(reverb);

    this.makeDrone(46.25, 'sawtooth', 0.034, -8, droneFilter);
    this.makeDrone(69.3, 'triangle', 0.058, 7, droneFilter);
    this.makeDrone(92.5, 'sine', 0.032, -13, droneFilter);

    const lfo = this.context.createOscillator();
    const lfoGain = this.context.createGain();
    lfo.frequency.value = 0.037;
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain).connect(droneFilter.frequency);
    lfo.start();
    this.nodes.push(lfo);

    const noise = this.context.createBufferSource();
    noise.buffer = this.createNoise(7);
    noise.loop = true;
    const noiseFilter = this.context.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 310;
    noiseFilter.Q.value = 0.5;
    const noiseGain = this.context.createGain();
    noiseGain.gain.value = 0.024;
    noise.connect(noiseFilter).connect(noiseGain).connect(reverb);
    noise.start();
    this.nodes.push(noise);

    this.reverb = reverb;
    this.dry = dry;
    this.createTowerAmbiences();
    this.interval = window.setInterval(() => this.scheduleArpeggio(), 2350);
    this.scheduleArpeggio();
    this.ensureRunning(true);
  },

  ensureRunning(playEntryTone = false) {
    if (!this.context || this.muted) return;

    const onRunning = () => {
      if (playEntryTone && !this.entryTonePlayed) {
        this.entryTonePlayed = true;
        this.playEntryTone();
      }
    };

    if (this.context.state === 'running') {
      onRunning();
      return;
    }

    this.context.resume()
      .then(onRunning)
      .catch(() => {
        showSignal('Sound is waiting for a tap. Tap SOUND ON once.', 4800);
      });
  },

  playEntryTone() {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const now = this.context.currentTime + 0.025;
    const frequencies = [110, 164.81, 220];
    frequencies.forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      oscillator.type = index === 0 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.detune.value = (index - 1) * 5;
      filter.type = 'lowpass';
      filter.frequency.value = 1050 - index * 140;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.095 : 0.06, now + 0.16 + index * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.8 + index * 0.25);
      oscillator.connect(filter).connect(gain).connect(this.reverb);
      oscillator.start(now);
      oscillator.stop(now + 3.2 + index * 0.25);
    });
  },

  createTowerAmbiences() {
    if (!this.context || this.towerAmbiences.length) return;

    this.towerConfigs.forEach((config, index) => {
      const bus = this.context.createGain();
      bus.gain.value = 0.0001;

      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = config.filter;
      filter.Q.value = config.filterQ;
      bus.connect(filter);

      const localDry = this.context.createGain();
      localDry.gain.value = 0.82;
      const localWet = this.context.createGain();
      localWet.gain.value = 0.64;
      filter.connect(localDry).connect(this.dry);
      filter.connect(localWet).connect(this.reverb);

      config.droneRatios.forEach((ratio, voiceIndex) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = config.droneTypes[voiceIndex];
        oscillator.frequency.value = config.root * ratio;
        oscillator.detune.value = (voiceIndex - 1) * 7 + index * 1.5;
        gain.gain.value = config.droneLevels[voiceIndex];
        oscillator.connect(gain).connect(bus);
        oscillator.start();
        this.nodes.push(oscillator);
      });

      const filterLfo = this.context.createOscillator();
      const filterLfoGain = this.context.createGain();
      filterLfo.frequency.value = 0.018 + index * 0.007;
      filterLfoGain.gain.value = 80 + index * 24;
      filterLfo.connect(filterLfoGain).connect(filter.frequency);
      filterLfo.start();
      this.nodes.push(filterLfo);

      const ambience = {
        bus,
        filter,
        currentLevel: 0,
        targetLevel: 0,
        phraseStep: 0,
        lastTarget: -1,
        interval: 0,
      };
      this.towerAmbiences.push(ambience);
      ambience.interval = window.setInterval(() => this.scheduleTowerPhrase(index), config.phraseEvery);
    });
  },

  scheduleTowerPhrase(index) {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const ambience = this.towerAmbiences[index];
    const config = this.towerConfigs[index];
    if (!ambience || ambience.currentLevel < 0.012) return;

    const start = this.context.currentTime + 0.035;
    const phraseOffset = ambience.phraseStep % config.pattern.length;
    ambience.phraseStep += 1;

    config.pattern.forEach((_, noteIndex) => {
      const patternIndex = (noteIndex + phraseOffset) % config.pattern.length;
      const semitone = config.pattern[patternIndex];
      const frequency = config.root * Math.pow(2, semitone / 12) * 2;
      const noteStart = start + noteIndex * config.noteSpacing;
      const noteEnd = noteStart + config.noteLength;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      const pan = this.context.createStereoPanner ? this.context.createStereoPanner() : this.context.createGain();

      oscillator.type = noteIndex % 3 === 2 && index === 3 ? 'sine' : config.noteType;
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      oscillator.detune.value = Math.sin((noteIndex + 1) * 2.31 + index) * 6;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(config.filter * (0.72 + (noteIndex % 3) * 0.17), noteStart);
      filter.frequency.exponentialRampToValueAtTime(Math.max(120, config.filter * 0.26), noteEnd);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.115 / (1 + noteIndex * 0.08), noteStart + 0.42);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      if ('pan' in pan) {
        pan.pan.value = THREE.MathUtils.clamp(
          config.pan + Math.sin(noteIndex * 1.7 + index) * 0.38,
          -0.8,
          0.8,
        );
      }
      oscillator.connect(filter).connect(gain).connect(pan);
      pan.connect(ambience.bus);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.06);
    });
  },

  updateTowerAmbience() {
    if (!this.context || !this.towerAmbiences.length) return;

    const innerRadius = 24;
    const outerRadius = 148;
    const now = this.context.currentTime;

    this.towerAmbiences.forEach((ambience, index) => {
      const building = buildingDefs[index];
      const config = this.towerConfigs[index];
      if (!building || !config) return;

      const distance = Math.min(...players.map((viewPlayer) => Math.sqrt(wrappedDistanceSquared(
        viewPlayer.position.x,
        viewPlayer.position.z,
        building.x,
        building.z,
      ))));
      let proximity = THREE.MathUtils.clamp((outerRadius - distance) / (outerRadius - innerRadius), 0, 1);
      proximity = proximity * proximity * (3 - 2 * proximity);
      const target = proximity * config.maxGain;
      ambience.currentLevel += (target - ambience.currentLevel) * 0.055;

      if (Math.abs(ambience.currentLevel - ambience.lastTarget) > 0.0025 || (target === 0 && ambience.lastTarget !== 0)) {
        ambience.bus.gain.cancelScheduledValues(now);
        ambience.bus.gain.setTargetAtTime(Math.max(0.0001, ambience.currentLevel), now, 0.24);
        ambience.lastTarget = target === 0 ? 0 : ambience.currentLevel;
      }
    });
  },

  makeDrone(frequency, type, level, detune, destination) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.detune.value = detune;
    gain.gain.value = level;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    this.nodes.push(oscillator);
  },

  createImpulse(seconds, decay) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const impulse = this.context.createBuffer(2, length, this.context.sampleRate);
    const impulseRandom = mulberry32(8891);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (impulseRandom() * 2 - 1) * ((1 - i / length) ** decay);
      }
    }
    return impulse;
  },

  createNoise(seconds) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    const noiseRandom = mulberry32(2057);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = noiseRandom() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      data[i] = last * 3.2;
    }
    return buffer;
  },

  scheduleArpeggio() {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const notes = [92.5, 110, 138.59, 164.81, 123.47, 103.83, 184.99, 146.83];
    const base = notes[this.step % notes.length];
    const now = this.context.currentTime + 0.04;
    this.step += 1;

    [1, 2].forEach((ratio, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      const pan = this.context.createStereoPanner ? this.context.createStereoPanner() : this.context.createGain();
      oscillator.type = index === 0 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(base * ratio, now);
      oscillator.detune.value = index === 0 ? -7 : 9;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(index === 0 ? 680 : 980, now);
      filter.frequency.exponentialRampToValueAtTime(160, now + 3.4);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.062 : 0.028, now + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.1);
      if ('pan' in pan) pan.pan.value = index === 0 ? -0.32 : 0.37;
      oscillator.connect(filter).connect(gain).connect(pan);
      pan.connect(this.reverb);
      oscillator.start(now);
      oscillator.stop(now + 4.2);
    });
  },

  playEcho(index) {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    const roots = [174.61, 196, 220, 233.08, 261.63, 293.66];
    [1, 1.5, 2.02].forEach((ratio, noteIndex) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = noteIndex === 0 ? 'sine' : 'triangle';
      oscillator.frequency.value = roots[index] * ratio;
      gain.gain.setValueAtTime(0.0001, now + noteIndex * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.065 / (noteIndex + 1), now + 0.18 + noteIndex * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.8);
      oscillator.connect(gain).connect(this.reverb);
      oscillator.start(now + noteIndex * 0.16);
      oscillator.stop(now + 5);
    });
  },

  playLoopTone() {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(74, now);
    oscillator.frequency.exponentialRampToValueAtTime(37, now + 2.2);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
    oscillator.connect(gain).connect(this.reverb);
    oscillator.start(now);
    oscillator.stop(now + 2.5);
  },

  playTowerAwakening(index) {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const now = this.context.currentTime + 0.02;
    const root = this.towerConfigs[index]?.root || 65.41;
    const frequencies = [root * 0.5, root, root * 1.498, root * 2.02];
    frequencies.forEach((frequency, voiceIndex) => {
      const oscillator = this.context.createOscillator();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      oscillator.type = voiceIndex === 0 ? 'sawtooth' : (voiceIndex === 2 ? 'triangle' : 'sine');
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (voiceIndex % 2 ? 1.045 : 0.965), now + 4.8);
      filter.type = 'bandpass';
      filter.Q.value = 1.4 + voiceIndex * 0.55;
      filter.frequency.setValueAtTime(260 + index * 95 + voiceIndex * 180, now);
      filter.frequency.exponentialRampToValueAtTime(1180 + index * 130 + voiceIndex * 220, now + 2.1);
      filter.frequency.exponentialRampToValueAtTime(180 + voiceIndex * 70, now + 5.3);
      gain.gain.setValueAtTime(0.0001, now + voiceIndex * 0.055);
      gain.gain.exponentialRampToValueAtTime(voiceIndex === 0 ? 0.13 : 0.075, now + 0.28 + voiceIndex * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.7 + voiceIndex * 0.12);
      oscillator.connect(filter).connect(gain).connect(this.reverb);
      oscillator.start(now + voiceIndex * 0.055);
      oscillator.stop(now + 6.1 + voiceIndex * 0.12);
    });
  },

  playTagProjectileHit() {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const now = this.context.currentTime + 0.01;
    [440, 660, 990].forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = index === 0 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.045);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.72, now + 0.55);
      gain.gain.setValueAtTime(0.0001, now + index * 0.045);
      gain.gain.exponentialRampToValueAtTime(0.075 / (index + 1), now + 0.07 + index * 0.045);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
      oscillator.connect(gain).connect(this.reverb);
      oscillator.start(now + index * 0.045);
      oscillator.stop(now + 0.78);
    });
  },


  playPowerPickup(type = 'speed') {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const rootMap = { speed: 329.63, jump: 392, fly: 523.25, blast: 261.63 };
    const root = rootMap[type] || 329.63;
    const now = this.context.currentTime + 0.01;
    [1, 1.25, 1.5].forEach((ratio, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = index === 2 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(root * ratio, now + index * 0.05);
      oscillator.frequency.exponentialRampToValueAtTime(root * ratio * 1.16, now + 0.42 + index * 0.04);
      gain.gain.setValueAtTime(0.0001, now + index * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.06 / (1 + index * 0.12), now + 0.08 + index * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75 + index * 0.05);
      oscillator.connect(gain).connect(this.reverb);
      oscillator.start(now + index * 0.05);
      oscillator.stop(now + 0.84 + index * 0.05);
    });
  },

  playExplosion(charged = false) {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const now = this.context.currentTime + 0.01;
    const noise = this.context.createBufferSource();
    noise.buffer = this.noiseBuffer || (this.noiseBuffer = this.createNoise(0.45));
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = charged ? 920 : 680;
    filter.Q.value = 0.8;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(charged ? 0.12 : 0.09, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    noise.connect(filter).connect(gain).connect(this.reverb);
    noise.start(now);
    noise.stop(now + 0.4);
  },


  playNpcChatter(seed = 0) {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const now=this.context.currentTime+0.01;
    const base=78+(seed%7)*9;
    for(let i=0;i<3;i+=1){
      const osc=this.context.createOscillator(); const gain=this.context.createGain(); const filter=this.context.createBiquadFilter();
      osc.type=i===0?'triangle':'sawtooth'; osc.frequency.setValueAtTime(base*(1+i*0.36),now+i*0.07);
      osc.frequency.exponentialRampToValueAtTime(base*(0.82+i*0.29),now+0.28+i*0.06);
      filter.type='lowpass'; filter.frequency.value=380+i*110;
      gain.gain.setValueAtTime(0.0001,now+i*0.07); gain.gain.exponentialRampToValueAtTime(0.018/(i+1),now+0.04+i*0.07); gain.gain.exponentialRampToValueAtTime(0.0001,now+0.34+i*0.06);
      osc.connect(filter).connect(gain).connect(this.reverb); osc.start(now+i*0.07); osc.stop(now+0.42+i*0.08);
    }
  },

  playCompletion() {
    if (!this.context || this.muted) return;
    [0, 1, 2, 3].forEach((step) => {
      window.setTimeout(() => this.playEcho(step % echoDefs.length), step * 680);
    });
  },

  toggle() {
    if (!this.context) {
      this.muted = false;
      this.start();
    } else {
      this.muted = !this.muted;
      if (this.master) {
        const now = this.context.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.38, now, 0.08);
      }
      if (!this.muted) this.ensureRunning(true);
    }
    ui.sound.textContent = this.muted ? 'SOUND OFF' : 'SOUND  ON';
    ui.pauseSound.textContent = this.muted ? 'SOUND OFF' : 'SOUND  ON';
    ui.sound.setAttribute('aria-label', this.muted ? 'Turn on ambient sound' : 'Mute ambient sound');
    ui.pauseSound.setAttribute('aria-label', this.muted ? 'Turn on ambient sound' : 'Mute ambient sound');
  },
};

function checkSelections(first, second, warning) {
  const sameDevice = first.value === second.value && first.value !== 'touch';
  warning.textContent = sameDevice ? 'Choose a different device for each player. Touchscreen can be shared.' : '';
  return !sameDevice;
}

function validateInputSelections() {
  const valid = checkSelections(ui.player1Input, ui.player2Input, ui.inputWarning);
  ui.enter.disabled = !worldReady || !valid;
  updateInputHints();
  return valid;
}

function validatePauseSelections() {
  const valid = checkSelections(ui.pausePlayer1Input, ui.pausePlayer2Input, ui.pauseInputWarning);
  ui.resume.disabled = !valid;
  updateInputHints();
  return valid;
}

function updateInputHints() {
  const mode = ui.modeSelect?.value || currentGameMode || 'survey';
  for (const select of document.querySelectorAll('.player-card .input-select')) {
    const hint = select.parentElement.querySelector('.input-hint');
    if (!hint) continue;
    if (mode !== 'survey') {
      hint.textContent = select.value === 'keyboard'
        ? 'W/S thrust-brake | A/D turn | mouse steer/climb | Shift boost'
        : select.value === 'touch'
          ? 'Left drag thrust/turn | right drag steer/climb | hold far forward for boost.'
          : 'Left stick thrust/turn | right stick steer/climb | RT/LB boost';
    } else {
      hint.textContent = select.value === 'keyboard'
        ? 'WASD move | mouse look | Space jump | B/E build | hold F charge'
        : select.value === 'touch'
          ? 'Within your view: left drag to walk, right drag to look. Use BUILD, PLACE, THROW and JUMP.'
          : 'Left stick move | right stick look | A jump | Y/X build | hold RB charge';
    }
  }
}

function updateGamepadStatus() {
  const pads = safeGamepads();
  const connected = pads.filter((p) => p && p.connected !== false);
  const text = connected.length
    ? connected.map((p) => `Gamepad ${p.index + 1}: ${p.id.slice(0, 45)}`).join(' | ')
    : 'No controller detected. Connect it and press a button to wake it.';
  ui.gamepadStatus.textContent = text;
  ui.pauseGamepadStatus.textContent = text;
  const slots = new Set([0, 1, ...connected.map((p) => p.index)]);
  for (const select of document.querySelectorAll('.input-select')) {
    for (const i of slots) {
      const value = `gamepad-${i}`;
      let option = Array.from(select.options).find((o) => o.value === value);
      if (!option) { option = document.createElement('option'); option.value = value; select.append(option); }
      const pad = pads[i];
      option.textContent = `Gamepad ${i + 1} / Xbox${pad?.connected !== false && pad ? ' (connected)' : ' (not detected)'}`;
    }
  }
}

function pauseGame() {
  if (!started || helpOpen || !ui.pause.hidden) return;
  ui.pausePlayer1Input.value = inputAssignments[0];
  ui.pausePlayer2Input.value = inputAssignments[1];
  ui.pause.hidden = false;
  resetInputs();
  validatePauseSelections();
  updateGamepadStatus();
  hadPointerLock = false;
  suppressLockLossUntil = performance.now() + 250;
  if (document.pointerLockElement) document.exitPointerLock?.();
  ui.pausePlayer1Input.focus({ preventScroll: true });
}


function resetPlayersForLevel() {
  const starts = currentLevel === 'skyline' ? [[-4,26,-0.82],[4,19,Math.PI-0.82]]
    : currentLevel === 'city' ? [[-5,24,-0.72],[5,17,Math.PI-0.72]]
    : currentLevel === 'mountains' ? [[-5,28,-0.9],[5,21,Math.PI-0.9]]
    : [[-4,28,-0.852],[4,21,Math.PI-0.852]];
  players.forEach((p,i)=>{
    p.position.set(starts[i][0],0,starts[i][1]); p.yaw=starts[i][2]; p.pitch=0.08;
    p.verticalVelocity=0; p.grounded=true; p.distance=0; p.loop=1; p.towerRoofIndex=-1;
    p.powerTimers={speed:0,jump:0,fly:0,blast:0,shrink:0,grow:0}; p.appliedScale=1; p.isRunning=false; p.building=false;
    p.position.y=heightAt(p.position.x,p.position.z)+EYE_HEIGHT;
  });
  INITIAL_POWERUP_ANCHORS.forEach((anchor,i)=>{
    const p=players[i]; anchor.x=wrapWorld(p.position.x-Math.sin(p.yaw)*INITIAL_POWERUP_DISTANCE); anchor.z=wrapWorld(p.position.z-Math.cos(p.yaw)*INITIAL_POWERUP_DISTANCE);
  });
}

function rebuildWorldForLevel(level) {
  random = mulberry32(719451);
  currentLevel = level || 'forest';
  treeColliders.length=0; structureColliders.length=0; animatedStructures.length=0; towerVisuals.length=0; towerStates.length=0;
  echoVisuals.length=0; skyLightVisuals.length=0; fireflyVisuals.length=0; discoveredEchoes.clear();
  avatarVisuals.length=0; temporaryBlocks.length=0; thrownCubes.length=0; powerups.length=0; explosionBursts.length=0;
  buildPreviews.length=0; levelPlatforms.length=0; npcVisuals.length=0;
  shipVisuals.length=0; raceCheckpoints.length=0; vehiclePowerups.length=0;
  simulationTime=0; nextBlockId=1; nextThrowableId=1; taggedPlayer=0; lastTagTransfer=-Infinity;
  resetPlayersForLevel();
  buildScene();
  updateReadouts(); updateBuildReadouts(); updateTagHud(); updatePowerupOverlays?.();
}

function updateLevelDescription() {
  const level = ui.levelSelect?.value || 'forest';
  if (ui.levelDescription) ui.levelDescription.textContent = LEVEL_INFO[level]?.description || LEVEL_INFO.forest.description;
}

function updateModeDescription() {
  const mode = ui.modeSelect?.value || 'survey';
  if (ui.modeDescription) ui.modeDescription.textContent = GAME_MODE_INFO[mode]?.description || GAME_MODE_INFO.survey.description;
  updateInputHints();
}

function enterGame() {
  if (!worldReady || !validateInputSelections()) return;
  const selectedLevel = ui.levelSelect?.value || 'forest';
  const selectedMode = ui.modeSelect?.value || 'survey';
  if (selectedLevel !== currentLevel || selectedMode !== currentGameMode) {
    currentGameMode = selectedMode;
    rebuildWorldForLevel(selectedLevel);
  }
  document.body.classList.toggle('vehicle-mode', currentGameMode !== 'survey');
  inputAssignments[0] = ui.player1Input.value;
  inputAssignments[1] = ui.player2Input.value;
  started = true;
  ui.start.classList.add('leaving');
  ui.start.hidden = true;
  ui.hud.classList.add('active');
  ui.hud.setAttribute('aria-hidden', 'false');
  ui.splitOverlay.classList.add('active');
  ui.splitOverlay.setAttribute('aria-hidden', 'false');
  resetInputs();
  audioEngine.start();
  requestPointerLockSafely();
  updateReadouts();
  updateBuildReadouts();
  updateTagHud();
  showSignal(`${GAME_MODE_INFO[currentGameMode]?.label || 'VERMILION LOOP'} · ${LEVEL_INFO[currentLevel]?.label || 'VERMILION LOOP'}`, 3000);
  if (currentGameMode === 'survey') {
    window.setTimeout(() => showSignal('POWER CRYSTALS ARE AHEAD. FOLLOW THE BRIGHT BEAMS AND BUILD STEPS UP TO THEM.', 6500), 1300);
  } else if (currentGameMode === 'race') {
    window.setTimeout(() => showSignal('RACE: 3 LAPS · FLY THROUGH THE NUMBERED CHECKPOINT GATES IN ORDER · COLLECT FLOATING SHIP CRYSTALS · SHIFT / TRIGGER BOOSTS', 6500), 900);
  } else {
    window.setTimeout(() => showSignal('FREE FLY: W / LEFT STICK THRUST · MOUSE / RIGHT STICK STEER · SHIFT / TRIGGER BOOSTS', 6500), 900);
  }
}

function resumeGame(applyChanges = true) {
  if (!started) return;
  if (applyChanges && !validatePauseSelections()) return;
  if (applyChanges) {
    inputAssignments[0] = ui.pausePlayer1Input.value;
    inputAssignments[1] = ui.pausePlayer2Input.value;
    ui.player1Input.value = inputAssignments[0];
    ui.player2Input.value = inputAssignments[1];
  }
  helpOpen = false;
  ui.pause.hidden = true;
  resetInputs();
  audioEngine.ensureRunning(false);
  renderer.domElement.focus({ preventScroll: true });
  updateReadouts();
  updateBuildReadouts();
  requestPointerLockSafely();
}

function requestPointerLockSafely() {
  if (!gameIsActive() || keyboardPlayerIndex() < 0 || document.pointerLockElement === renderer.domElement) return;
  const fallback = () => showSignal('Click the view for mouse look, or hold and drag. Tab opens MENU.', 4200);
  if (!renderer.domElement.requestPointerLock) { fallback(); return; }
  try { renderer.domElement.requestPointerLock()?.catch?.(fallback); }
  catch { fallback(); }
}

function openHelp() {
  if (helpOpen) return;
  if (started && ui.pause.hidden) pauseGame();
  returnToPauseAfterHelp = started;
  helpOpen = true;
  hadPointerLock = false;
  if (document.pointerLockElement) document.exitPointerLock?.();
  if (!ui.helpDialog.open) ui.helpDialog.showModal();
}

function closeHelp() {
  helpOpen = false;
  if (ui.helpDialog.open) ui.helpDialog.close();
  if (returnToPauseAfterHelp) { ui.pause.hidden = false; ui.resume.focus({ preventScroll: true }); }
}

// Continue polling the gamepads while paused. Controller-only players can
// navigate, change the device assignments and return without reaching a mouse.
function pollMenuGamepads() {
  const pads = safeGamepads();
  let usedAction = false;
  for (const pad of pads) {
    if (!pad || pad.connected === false) continue;
    const before = menuPadState.get(pad.index) || { buttons: [], direction: '', repeatAt: 0 };
    const buttons = pad.buttons.map((b) => b.pressed);
    const edge = (i) => !!buttons[i] && !before.buttons[i];
    const now = performance.now();
    const next = { buttons, direction: before.direction, repeatAt: before.repeatAt };
    menuPadState.set(pad.index, next);
    if (usedAction) continue;
    if (edge(9) && started && !helpOpen) {
      if (ui.pause.hidden) pauseGame(); else resumeGame(true);
      usedAction = true; continue;
    }
    if (helpOpen) { if (edge(1) || edge(9)) closeHelp(); continue; }
    const panel = !started ? ui.start : !ui.pause.hidden ? ui.pause : null;
    if (!panel) { next.direction = ''; continue; }
    const elements = Array.from(panel.querySelectorAll('select,button')).filter((el) => !el.disabled && !el.hidden && el.getClientRects().length);
    if (!elements.length) continue;
    if (edge(1) && started) { resumeGame(false); usedAction = true; continue; }
    let index = elements.indexOf(document.activeElement);
    if (index < 0) index = 0;
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    const direction = buttons[12] || ay < -0.6 ? 'up' : buttons[13] || ay > 0.6 ? 'down'
      : buttons[14] || ax < -0.6 ? 'left' : buttons[15] || ax > 0.6 ? 'right' : '';
    if (direction && (direction !== before.direction || now > before.repeatAt)) {
      next.repeatAt = now + (direction === before.direction ? 170 : 400);
      if (direction === 'up' || direction === 'down') {
        index = (index + (direction === 'up' ? -1 : 1) + elements.length) % elements.length;
        elements[index].focus({ preventScroll: true });
        elements[index].scrollIntoView({ block: 'nearest' });
      } else if (elements[index].tagName === 'SELECT') {
        const select = elements[index];
        select.focus({ preventScroll: true });
        select.selectedIndex = (select.selectedIndex + (direction === 'left' ? -1 : 1) + select.options.length) % select.options.length;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    next.direction = direction;
    if (edge(0)) {
      const el = elements[index];
      el.focus({ preventScroll: true });
      if (el.tagName === 'SELECT') {
        el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else el.click();
      usedAction = true;
    }
  }
}

function bindEvents() {
  ui.enter.addEventListener('click', enterGame);
  ui.player1Input.addEventListener('change', validateInputSelections);
  ui.player2Input.addEventListener('change', validateInputSelections);
  ui.levelSelect?.addEventListener('change', updateLevelDescription);
  ui.modeSelect?.addEventListener('change', updateModeDescription);
  ui.pausePlayer1Input.addEventListener('change', validatePauseSelections);
  ui.pausePlayer2Input.addEventListener('change', validatePauseSelections);
  window.addEventListener('gamepadconnected', updateGamepadStatus);
  window.addEventListener('gamepaddisconnected', (event) => {
    if (event.gamepad) menuPadState.delete(event.gamepad.index);
    updateGamepadStatus();
    if (started && inputAssignments.some((a) => a.startsWith('gamepad-') && !gamepadForAssignment(a))) pauseGame();
  });
  window.setInterval(updateGamepadStatus, 1200);
  updateGamepadStatus();
  ui.menu.addEventListener('click', pauseGame);
  ui.resume.addEventListener('click', () => resumeGame(true));
  ui.cancelControls.addEventListener('click', () => resumeGame(false));
  ui.sound.addEventListener('click', () => audioEngine.toggle());
  ui.pauseSound.addEventListener('click', () => audioEngine.toggle());
  ui.help.addEventListener('click', openHelp);
  ui.pauseHelp.addEventListener('click', openHelp);
  ui.closeHelp.addEventListener('click', closeHelp);
  ui.helpDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeHelp(); });
  for (let i = 0; i < 2; i++) {
    const actions = {
      [`build-toggle-${i}`]: () => toggleBuild(i),
      [`place-block-${i}`]: () => placeBlock(i),
      [`touch-jump-${i}`]: () => { if (gameIsActive()) players[i].jumpRequested = true; },
    };
    for (const [id, action] of Object.entries(actions)) {
      const button = document.getElementById(id);
      // Pointerdown responds immediately and supports a second finger still
      // steering the view. Cancelled events must not generate a second action.
      button.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'mouse' || event.button === 0) {
          event.preventDefault(); event.stopPropagation();
          audioEngine.ensureRunning(false); action();
        }
      });
      button.addEventListener('click', (event) => { if (event.detail === 0) action(); });
    }
    const throwButton = document.getElementById(`throw-cube-${i}`);
    throwButton?.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'mouse' || event.button === 0) { event.preventDefault(); event.stopPropagation(); audioEngine.ensureRunning(false); beginThrowCharge(i, 'touch'); } });
    const releaseTouchThrow = (event) => { event.preventDefault(); event.stopPropagation(); releaseThrowCharge(i); };
    throwButton?.addEventListener('pointerup', releaseTouchThrow); throwButton?.addEventListener('pointercancel', releaseTouchThrow);
  }

  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!gameIsActive()) return;
    audioEngine.ensureRunning(false);
    if (event.pointerType === 'touch') {
      event.preventDefault();
      const playerIndex = event.clientX < window.innerWidth * 0.5 ? 0 : 1;
      if (inputAssignments[playerIndex] !== 'touch') return;
      const touch = touchControls[playerIndex];
      const viewportLeft = playerIndex === 0 ? 0 : window.innerWidth * 0.5;
      const onMoveSide = event.clientX - viewportLeft < window.innerWidth * 0.25;
      if (onMoveSide && touch.movePointerId === null) {
        touch.movePointerId = event.pointerId;
        touch.moveStartX = event.clientX; touch.moveStartY = event.clientY;
        touch.moveForward = 0; touch.moveSide = 0; touch.sprint = false;
        renderer.domElement.setPointerCapture?.(event.pointerId);
      } else if (!onMoveSide && touch.lookPointerId === null) {
        const now = performance.now();
        if (touch.lastLookTap > 0 && now - touch.lastLookTap < 310) players[playerIndex].jumpRequested = true;
        touch.lastLookTap = now;
        touch.lookPointerId = event.pointerId;
        touch.lookLastX = event.clientX; touch.lookLastY = event.clientY;
        renderer.domElement.setPointerCapture?.(event.pointerId);
      }
      return;
    }
    const index = keyboardPlayerIndex();
    if (index < 0) return;
    if (event.button === 2) { beginThrowCharge(index, 'mouse'); return; }
    if (event.button !== 0) return;
    if (document.pointerLockElement === renderer.domElement) {
      if (players[index].building) placeBlock(index);
      return;
    }
    dragLooking = true;
    lastPointerX = event.clientX; lastPointerY = event.clientY;
    renderer.domElement.setPointerCapture?.(event.pointerId);
    requestPointerLockSafely();
  });

  renderer.domElement.addEventListener('pointerup', (event) => { if (event.button !== 2 || event.pointerType === 'touch') return; const index = keyboardPlayerIndex(); if (index >= 0) releaseThrowCharge(index); });

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch' || !gameIsActive()) return;
    for (let i = 0; i < 2; i++) {
      if (inputAssignments[i] !== 'touch') continue;
      const touch = touchControls[i];
      if (event.pointerId === touch.movePointerId) {
        event.preventDefault();
        const dx = event.clientX - touch.moveStartX, dy = event.clientY - touch.moveStartY;
        touch.moveSide = THREE.MathUtils.clamp(Math.abs(dx) < 7 ? 0 : dx / 72, -1, 1);
        touch.moveForward = THREE.MathUtils.clamp(Math.abs(dy) < 7 ? 0 : -dy / 72, -1, 1);
        touch.sprint = Math.hypot(dx, dy) > 92;
        return;
      }
      if (event.pointerId === touch.lookPointerId) {
        event.preventDefault();
        const dx = event.clientX - touch.lookLastX, dy = event.clientY - touch.lookLastY;
        touch.lookLastX = event.clientX; touch.lookLastY = event.clientY;
        players[i].yaw -= dx * 0.0031;
        players[i].pitch = THREE.MathUtils.clamp(players[i].pitch - dy * 0.0027, -1.42, 1.38);
        return;
      }
    }
  }, { passive: false });

  const endPointer = (event) => {
    for (const touch of touchControls) {
      if (event.pointerId === touch.movePointerId) {
        touch.movePointerId = null; touch.moveForward = 0; touch.moveSide = 0; touch.sprint = false;
      }
      if (event.pointerId === touch.lookPointerId) touch.lookPointerId = null;
    }
    if (renderer.domElement.hasPointerCapture?.(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    if (event.pointerType !== 'touch') dragLooking = false;
  };
  renderer.domElement.addEventListener('pointerup', endPointer);
  renderer.domElement.addEventListener('pointercancel', endPointer);
  renderer.domElement.addEventListener('lostpointercapture', endPointer);

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === renderer.domElement) {
      if (!gameIsActive()) { document.exitPointerLock?.(); return; }
      hadPointerLock = true;
      dragLooking = false;
    } else {
      const wasLocked = hadPointerLock;
      hadPointerLock = false;
      if (wasLocked && started && !helpOpen && performance.now() > suppressLockLossUntil) pauseGame();
    }
  });
  document.addEventListener('mousemove', (event) => {
    if (!gameIsActive()) return;
    let dx = 0, dy = 0;
    if (document.pointerLockElement === renderer.domElement) { dx = event.movementX; dy = event.movementY; }
    else if (dragLooking) {
      dx = event.clientX - lastPointerX; dy = event.clientY - lastPointerY;
      lastPointerX = event.clientX; lastPointerY = event.clientY;
    } else return;
    const index = keyboardPlayerIndex();
    if (index < 0) return;
    players[index].yaw -= dx * 0.00185;
    players[index].pitch = THREE.MathUtils.clamp(players[index].pitch - dy * 0.0017, -1.42, 1.38);
  });

  document.addEventListener('keydown', (event) => {
    if (started) audioEngine.ensureRunning(false);
    if (helpOpen) return;
    if (started && event.code === 'Escape' && !event.repeat) {
      if (!ui.pause.hidden) { event.preventDefault(); resumeGame(false); }
      else if (document.pointerLockElement !== renderer.domElement) pauseGame();
      return;
    }
    if (!gameIsActive()) return;
    if (event.code === 'Tab' || event.code === 'KeyP') {
      event.preventDefault(); if (!event.repeat) pauseGame(); return;
    }
    keys[event.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (event.repeat) return;
    const index = keyboardPlayerIndex();
    if (index >= 0) {
      if (event.code === 'Space') players[index].jumpRequested = true;
      if (event.code === 'KeyB') toggleBuild(index);
      if (event.code === 'KeyE') placeBlock(index);
      if (event.code === 'KeyF') beginThrowCharge(index, 'keyboard');
    }
    if (event.code === 'KeyM') audioEngine.toggle();
    if (event.code === 'KeyC' || event.code === 'KeyH') openHelp();
  });
  document.addEventListener('keyup', (event) => { keys[event.code] = false; if (event.code === 'KeyF') { const index = keyboardPlayerIndex(); if (index >= 0) releaseThrowCharge(index); } });
  window.addEventListener('blur', () => { resetInputs(); if (started && !helpOpen) pauseGame(); });
  window.addEventListener('resize', () => {
    const aspect = Math.max(0.25, window.innerWidth * 0.5 / window.innerHeight);
    camera.aspect = aspect; camera2.aspect = aspect;
    camera.updateProjectionMatrix(); camera2.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.55));
    renderer.setSize(window.innerWidth, window.innerHeight);
    resetInputs();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resetInputs(); if (started && !helpOpen) pauseGame();
      audioEngine.context?.suspend();
    } else if (started && !audioEngine.muted) audioEngine.ensureRunning(false);
  });
}


function showFatalError() {
  ui.loading.classList.add('ready');
  ui.enter.disabled = true;
  ui.enter.innerHTML = '<span>WEBGL IS NOT AVAILABLE</span>';
  document.querySelector('.intro').innerHTML = 'This landscape could not be formed.<br />Try a current browser with hardware acceleration.';
}

// Shared temporary steps and the two surveyors. All positions use the same
// toroidal coordinates as the forest, not either viewport's temporary copies.
const BLOCK_SIZE = 4;
const BLOCK_HEIGHT = 1.2;
const BLOCK_LIFETIME = 30;
const BLOCK_LIMIT = 100;
const PLAYER_RADIUS = 0.62;
const PLAYER_HEIGHT = 4.3;
const STEP_HEIGHT = 1.72; // Includes a small allowance for uneven ground at the first step.
const TAG_DISTANCE = 1.75;
const TAG_COOLDOWN = 1.35;
const THROW_LIFETIME = 30;
const THROW_LIMIT = 54;
const THROW_RADIUS = 0.22;
const POWER_DURATION = 60;
const ACTIVE_POWERUP_COUNT = 2;
const POWERUP_PICKUP_RADIUS = 2.75;
const POWERUP_MIN_HEIGHT = 8.2;
const POWERUP_MAX_HEIGHT = 12.8;
const avatarVisuals = [];
const temporaryBlocks = [];
const thrownCubes = [];
const powerups = [];
const explosionBursts = [];
const levelPlatforms = [];
const npcVisuals = [];
const throwCharges = [
  { active: false, started: 0, source: '' },
  { active: false, started: 0, source: '' },
];
const buildPreviews = [];
const buildCandidates = [null, null];
const buildMessages = [{ text: '', until: 0 }, { text: '', until: 0 }];
const menuPadState = new Map();
let simulationTime = 0;
let nextBlockId = 1;
let blockGeometry;
let blockEdgeGeometry;
let blockBarGeometry;
let throwableGeometry;
let throwableEdgeGeometry;
let nextThrowableId = 1;
let taggedPlayer = 0;
let lastTagTransfer = -Infinity;
let returnToPauseAfterHelp = false;
let suppressLockLossUntil = 0;

function wrapWorld(value) {
  return THREE.MathUtils.euclideanModulo(value + HALF_WORLD, WORLD_SIZE) - HALF_WORLD;
}

function gameIsActive() {
  return started && ui.pause.hidden && !helpOpen && !document.hidden;
}

function safeGamepads() {
  try { return Array.from(navigator.getGamepads?.() || []); }
  catch { return []; }
}

function makeFlatGeometry(vertices, faces) {
  const geometry = new THREE.BufferGeometry();
  const coords = [];
  for (const face of faces) for (const i of face) coords.push(...vertices[i]);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildSurveyors() {
  players.forEach((p, i) => {
    p.building = false;
    p.lastPlacedAt = -Infinity;
    p.walkPhase = 0;
    p.walkAmount = 0;
    p.stepViewOffset = 0;
    p.lastGroundHeight = p.position.y - EYE_HEIGHT;
    const root = new THREE.Group();
    root.name = `Surveyor ${i + 1}`;
    const figure = new THREE.Group();
    root.add(figure);
    const cloth = new THREE.MeshStandardMaterial({
      color: i === 0 ? 0xa34430 : 0x215753,
      roughness: 0.96, flatShading: true, side: THREE.DoubleSide,
    });
    const folds = new THREE.MeshStandardMaterial({
      color: i === 0 ? 0x632b28 : 0x113837,
      roughness: 1, flatShading: true, side: THREE.DoubleSide,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x091b20, roughness: 1, flatShading: true });
    const accent = new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffba7b : 0xa1ffde });
    const tagMaterial = new THREE.MeshBasicMaterial({ color: 0xffe06f, transparent: true, opacity: 0.78, depthWrite: false });
    const tagHalo = new THREE.Group();
    const haloA = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.055, 5, 24), tagMaterial);
    haloA.rotation.x = Math.PI / 2;
    haloA.position.y = 2.25;
    const haloB = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.045, 5, 20), tagMaterial.clone());
    haloB.rotation.set(Math.PI / 2, 0.52, 0.16);
    haloB.position.y = 3.05;
    const tagLight = new THREE.PointLight(0xffd75e, 0, 7, 2);
    tagLight.position.y = 2.5;
    tagHalo.add(haloA, haloB, tagLight);
    root.add(tagHalo);

    // Uneven seven-sided cloak. The upper ring pinches into angular shoulders,
    // while the rear hem drops further than the open front above the legs.
    const vertices = [];
    for (let j = 0; j < 7; j++) {
      const a = j / 7 * TAU;
      vertices.push([Math.cos(a) * 1.02, 1.02 + (j % 2) * 0.22, Math.sin(a) * 0.78]);
    }
    for (let j = 0; j < 7; j++) {
      const a = j / 7 * TAU;
      vertices.push([Math.cos(a) * 0.47, 3.05 + (j % 2) * 0.07, Math.sin(a) * 0.37]);
    }
    const faces = [];
    for (let j = 0; j < 7; j++) {
      const n = (j + 1) % 7;
      faces.push([j, n, 7 + j], [n, 7 + n, 7 + j]);
    }
    const cloak = new THREE.Mesh(makeFlatGeometry(vertices, faces), cloth);
    figure.add(cloak);

    const hood = new THREE.Mesh(makeFlatGeometry([
      [0, 4.28, 0.15], [-0.57, 3.48, -0.46], [0.57, 3.48, -0.46],
      [-0.45, 3.20, 0.45], [0.45, 3.20, 0.45], [0, 3.12, -0.65],
    ], [[0, 1, 3], [0, 3, 4], [0, 4, 2], [1, 5, 3], [5, 4, 3], [5, 2, 4], [0, 2, 1]]), cloth);
    figure.add(hood);
    const face = new THREE.Mesh(makeFlatGeometry([
      [-0.44, 3.49, -0.53], [0.44, 3.49, -0.53], [0, 3.14, -0.69],
    ], [[0, 2, 1]]), new THREE.MeshBasicMaterial({ color: 0x05171c, side: THREE.DoubleSide }));
    figure.add(face);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.02), accent);
    slit.position.set(0, 3.39, -0.63);
    figure.add(slit);
    const clasp = new THREE.Mesh(new THREE.OctahedronGeometry(0.115, 0), accent);
    clasp.position.set(0, 2.87, -0.43);
    figure.add(clasp);

    const legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.34, 1.47, 0);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.012, 1.5, 3, 1), dark);
      leg.position.y = -0.73;
      leg.rotation.z = side * 0.10;
      pivot.add(leg);
      figure.add(pivot);
      legs.push(pivot);
      const fold = new THREE.Mesh(makeFlatGeometry([
        [side * 0.40, 3.05, -0.24], [side * 1.06, 1.07, 0.06], [side * 0.49, 1.44, -0.59],
      ], [[0, 1, 2]]), folds);
      figure.add(fold);
    }
    const tail = new THREE.Mesh(makeFlatGeometry([
      [-0.37, 2.75, 0.39], [0.37, 2.75, 0.39], [0.24, 0.76, 1.03], [-0.69, 1.22, 0.89],
    ], [[0, 1, 2], [0, 2, 3]]), folds);
    figure.add(tail);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(4,24,26,0.76)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = i === 0 ? '#ffbb87' : '#a1ffde';
      ctx.font = 'bold 27px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`SURVEYOR 0${i + 1}`, 128, 33);
    }
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
    label.scale.set(2.8, 0.7, 1);
    label.position.y = 4.95;
    root.add(label);
    scene.add(root);
    avatarVisuals.push({ root, figure, cloak, legs, tail, label, cloth, folds, dark, accent, tagHalo, tagLight, haloA, haloB });
  });
}

function updateSurveyors(delta, time) {
  avatarVisuals.forEach((avatar, i) => {
    const p = players[i];
    const scale = playerScale(p);
    avatar.figure.scale.setScalar(scale);
    avatar.label.position.y = 4.95 * scale + 0.2;
    const stride = p.grounded ? p.walkAmount : 0.12;
    avatar.legs[0].rotation.x = Math.sin(p.walkPhase) * 0.33 * stride;
    avatar.legs[1].rotation.x = -Math.sin(p.walkPhase) * 0.33 * stride;
    avatar.cloak.rotation.z = Math.sin(time * 0.43 + i * 2) * 0.013;
    avatar.tail.rotation.x = Math.sin(time * 0.61 + i) * 0.018 + stride * 0.026;
    avatar.figure.rotation.x = p.grounded ? -stride * 0.025 : 0.03;
    const isTagged = i === taggedPlayer;
    avatar.tagHalo.visible = isTagged;
    if (isTagged) {
      const pulse = 1 + Math.sin(time * 4.2) * 0.08;
      avatar.tagHalo.scale.setScalar(pulse * scale);
      avatar.tagHalo.rotation.y = time * 0.7;
      avatar.haloA.material.opacity = 0.58 + Math.sin(time * 5.4) * 0.16;
      avatar.haloB.material.opacity = 0.38 + Math.cos(time * 4.7) * 0.12;
      avatar.tagLight.intensity = 4.8 + Math.sin(time * 4.5) * 1.2;
      avatar.cloth.emissive.setHex(0xff8f24); avatar.cloth.emissiveIntensity = 0.46;
      avatar.folds.emissive.setHex(0xff6b19); avatar.folds.emissiveIntensity = 0.28;
    } else {
      avatar.tagLight.intensity = 0;
      avatar.cloth.emissive.setHex(0x000000); avatar.cloth.emissiveIntensity = 0;
      avatar.folds.emissive.setHex(0x000000); avatar.folds.emissiveIntensity = 0;
    }
    p.stepViewOffset *= Math.exp(-delta * 15);
  });
  updateTagGame();
}


function updateTagHud() {
  for (let i = 0; i < 2; i++) {
    const frame = document.getElementById(`tag-frame-${i}`);
    frame?.classList.toggle('active', i === taggedPlayer && started);
  }
}

function updateTagGame() {
  updateTagHud();
  if (!gameIsActive() || simulationTime - lastTagTransfer < TAG_COOLDOWN) return;
  const a = players[0], b = players[1];
  const horizontal = Math.sqrt(wrappedDistanceSquared(a.position.x, a.position.z, b.position.x, b.position.z));
  const aFeet = a.position.y - playerEyeHeight(a), bFeet = b.position.y - playerEyeHeight(b);
  const vertical = Math.abs(aFeet - bFeet);
  const tagRange = Math.max(TAG_DISTANCE, playerRadius(a) + playerRadius(b) + 0.55);
  const verticalRange = Math.max(2.6, Math.min(playerHeight(a), playerHeight(b)) * 0.8 + 0.8);
  if (horizontal > tagRange || vertical > verticalRange) return;
  taggedPlayer = 1 - taggedPlayer;
  lastTagTransfer = simulationTime;
  showSignal(`TAG PASSED — PLAYER ${taggedPlayer + 1} HAS THE GLOW`, 2500);
  updateTagHud();
}

function buildThrowableKit() {
  throwableGeometry = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  throwableEdgeGeometry = new THREE.EdgesGeometry(throwableGeometry);
}

function makeGlitterPoints(owner) {
  const count = 16;
  const positions = new Float32Array(count * 3);
  const r = mulberry32(90210 + nextThrowableId * 31 + owner * 997);
  for (let i = 0; i < count; i++) {
    const radius = 0.28 + r() * 0.46;
    const angle = r() * TAU;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = (r() - 0.5) * 0.9;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: owner === 0 ? 0xffd783 : 0xa9ffe4,
    size: 0.09,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  return { points, geometry, material };
}


const POWERUP_DEFS = [
  { type: 'speed', label: 'SUPER SPEED', colour: 0xff745b, emissive: 0xff5225 },
  { type: 'jump', label: 'HIGH JUMP', colour: 0x62ffc8, emissive: 0x19c79f },
  { type: 'fly', label: 'FLIGHT', colour: 0x77b8ff, emissive: 0x3466ff },
  { type: 'blast', label: 'FAST BLAST CUBES', colour: 0xc688ff, emissive: 0x8f45ff },
  { type: 'shrink', label: 'TINY FORM', colour: 0xffef78, emissive: 0xd0a62b },
  { type: 'grow', label: 'GIANT FORM', colour: 0xff78c8, emissive: 0xc64091 },
];

function powerupDefinition(type) {
  return POWERUP_DEFS.find((def) => def.type === type) || POWERUP_DEFS[0];
}

function playerHasPower(playerOrIndex, type) {
  const playerRef = typeof playerOrIndex === 'number' ? players[playerOrIndex] : playerOrIndex;
  return Boolean(playerRef?.powerTimers?.[type] > simulationTime);
}

function powerTimeLeft(playerOrIndex, type) {
  const playerRef = typeof playerOrIndex === 'number' ? players[playerOrIndex] : playerOrIndex;
  return Math.max(0, Math.ceil((playerRef?.powerTimers?.[type] || 0) - simulationTime));
}

function playerScale(playerOrIndex) {
  const p = typeof playerOrIndex === 'number' ? players[playerOrIndex] : playerOrIndex;
  if (!p) return 1;
  if (playerHasPower(p, 'grow')) return 3;
  if (playerHasPower(p, 'shrink')) return 1 / 3;
  return 1;
}
function playerEyeHeight(p) { return EYE_HEIGHT * playerScale(p); }
function playerHeight(p) { return PLAYER_HEIGHT * playerScale(p); }
function playerRadius(p) { return PLAYER_RADIUS * playerScale(p); }
function playerStepHeight(p) { return STEP_HEIGHT * Math.max(0.45, playerScale(p)); }
function syncPlayerScale(p) {
  const desired = playerScale(p);
  const current = p.appliedScale || 1;
  if (Math.abs(desired - current) < 0.0001) return;
  const feet = p.position.y - EYE_HEIGHT * current;
  p.position.y = feet + EYE_HEIGHT * desired;
  p.appliedScale = desired;
}

function activePowerSummary(playerOrIndex) {
  const playerRef = typeof playerOrIndex === 'number' ? players[playerOrIndex] : playerOrIndex;
  const items = [];
  if (playerHasPower(playerRef, 'speed')) items.push(`SPD ${powerTimeLeft(playerRef, 'speed')}s`);
  if (playerHasPower(playerRef, 'jump')) items.push(`JMP ${powerTimeLeft(playerRef, 'jump')}s`);
  if (playerHasPower(playerRef, 'fly')) items.push(`FLY ${powerTimeLeft(playerRef, 'fly')}s`);
  if (playerHasPower(playerRef, 'blast')) items.push(`BLAST ${powerTimeLeft(playerRef, 'blast')}s`);
  if (playerHasPower(playerRef, 'shrink')) items.push(`TINY ${powerTimeLeft(playerRef, 'shrink')}s`);
  if (playerHasPower(playerRef, 'grow')) items.push(`GIANT ${powerTimeLeft(playerRef, 'grow')}s`);
  return items.join(' · ');
}

function powerupSiteIsClear(x, z, powerup = null, minimumSeparation = 30) {
  const ground = heightAt(x, z);
  if (isBlocked(x, z, ground)) return null;
  if (!isClearOfLandmarks(x, z, 8.2)) return null;
  if (levelPlatforms.some((platform) => overlapsLevelPlatformXZ(x, z, platform, 5.5))) return null;

  // Leave a broad, fairly level construction area below each crystal.
  if (treeColliders.some((tree) => wrappedDistanceSquared(x, z, tree.x, tree.z) < (tree.radius + 6.4) ** 2)) return null;
  const samples = [
    heightAt(x + 3.2, z), heightAt(x - 3.2, z),
    heightAt(x, z + 3.2), heightAt(x, z - 3.2),
    heightAt(x + 2.4, z + 2.4), heightAt(x - 2.4, z - 2.4),
  ];
  if (Math.max(...samples, ground) - Math.min(...samples, ground) > 2.7) return null;

  for (const other of powerups) {
    if (!other || other === powerup) continue;
    if (wrappedDistanceSquared(x, z, other.x, other.z) < minimumSeparation * minimumSeparation) return null;
  }
  return ground;
}

function findPowerupSpawn(powerup = null, avoidPlayerIndex = -1, preferredPlayerIndex = -1, initialSpawn = false) {
  // First try positions in a broad cone in front of a player. This makes the
  // crystals discoverable instead of hiding both on the far side of the loop.
  if (preferredPlayerIndex >= 0) {
    const p = players[preferredPlayerIndex];
    const distances = initialSpawn ? [27, 34, 42, 50, 58] : [44, 56, 70, 84, 98];
    const angleOffsets = initialSpawn
      ? [0, 0.3, -0.3, 0.58, -0.58, 0.9, -0.9]
      : [0, 0.42, -0.42, 0.78, -0.78, 1.18, -1.18, 1.55, -1.55];
    for (const distance of distances) {
      for (const angleOffset of angleOffsets) {
        const angle = p.yaw + angleOffset;
        const x = wrapWorld(p.position.x - Math.sin(angle) * distance);
        const z = wrapWorld(p.position.z - Math.cos(angle) * distance);
        const ground = powerupSiteIsClear(x, z, powerup, initialSpawn ? 24 : 36);
        if (ground === null) continue;
        if (avoidPlayerIndex >= 0 && wrappedDistanceSquared(x, z, players[avoidPlayerIndex].position.x, players[avoidPlayerIndex].position.z) < 32 * 32) continue;
        const height = POWERUP_MIN_HEIGHT + random() * (POWERUP_MAX_HEIGHT - POWERUP_MIN_HEIGHT);
        return { x, z, ground, y: ground + height };
      }
    }
  }

  // Keep respawns within a useful distance of the action before falling back
  // to a full-world search.
  for (let attempt = 0; attempt < 420; attempt += 1) {
    let x;
    let z;
    if (preferredPlayerIndex >= 0 && attempt < 280) {
      const p = players[preferredPlayerIndex];
      const angle = random() * TAU;
      const distance = 42 + random() * 70;
      x = wrapWorld(p.position.x + Math.cos(angle) * distance);
      z = wrapWorld(p.position.z + Math.sin(angle) * distance);
    } else {
      x = random() * WORLD_SIZE - HALF_WORLD;
      z = random() * WORLD_SIZE - HALF_WORLD;
    }
    const ground = powerupSiteIsClear(x, z, powerup, 34);
    if (ground === null) continue;
    if (avoidPlayerIndex >= 0 && wrappedDistanceSquared(x, z, players[avoidPlayerIndex].position.x, players[avoidPlayerIndex].position.z) < 32 * 32) continue;
    if (players.some((p) => wrappedDistanceSquared(x, z, p.position.x, p.position.z) < 17 * 17)) continue;
    const height = POWERUP_MIN_HEIGHT + random() * (POWERUP_MAX_HEIGHT - POWERUP_MIN_HEIGHT);
    return { x, z, ground, y: ground + height };
  }

  const anchor = preferredPlayerIndex >= 0 ? players[preferredPlayerIndex] : players[0];
  const fallbackX = wrapWorld(anchor.position.x - Math.sin(anchor.yaw) * 38 + (powerup ? 16 : -12));
  const fallbackZ = wrapWorld(anchor.position.z - Math.cos(anchor.yaw) * 38 + (powerup ? -12 : 14));
  const ground = heightAt(fallbackX, fallbackZ);
  return { x: fallbackX, z: fallbackZ, ground, y: ground + POWERUP_MIN_HEIGHT + 0.8 };
}

function updatePowerupBeaconGeometry(powerup) {
  const altitude = Math.max(4, powerup.y - powerup.ground);
  powerup.beam.position.y = -altitude * 0.5;
  powerup.beam.scale.set(1, altitude, 1);
  powerup.groundRing.position.y = -altitude + 0.08;
  powerup.groundRing2.position.y = -altitude + 0.12;
  powerup.groundRing2.scale.setScalar(1.35);
}

function redrawPowerupLabel(powerup) {
  const ctx = powerup.labelContext;
  if (!ctx) return;
  const def = powerupDefinition(powerup.type);
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(4, 24, 26, 0.78)';
  ctx.fillRect(0, 18, 512, 92);
  ctx.strokeStyle = `#${def.colour.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 24, 500, 80);
  ctx.fillStyle = '#fff4d4';
  ctx.font = '900 37px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.label, 256, 65);
  ctx.font = '700 20px Arial';
  ctx.fillStyle = `#${def.colour.toString(16).padStart(6, '0')}`;
  ctx.fillText('BUILD UP TO COLLECT', 256, 94);
  powerup.labelTexture.needsUpdate = true;
}

function applyPowerupStyle(powerup, type) {
  const def = powerupDefinition(type);
  powerup.type = def.type;
  powerup.label = def.label;
  powerup.colour = def.colour;
  for (const material of powerup.crystalMaterials) {
    material.color.setHex(def.colour);
    material.emissive.setHex(def.emissive);
  }
  powerup.edgeMaterial.color.setHex(0xf6ffff);
  powerup.haloMaterial.color.setHex(def.colour);
  powerup.light.color.setHex(def.colour);
  powerup.beamMaterial?.color.setHex(def.colour);
  powerup.groundRingMaterial?.color.setHex(def.colour);
  powerup.groundRing2?.material?.color.setHex(def.colour);
  powerup.group.name = `${def.label} crystal`;
  if (powerup.labelTexture) redrawPowerupLabel(powerup);
}

function buildPowerups() {
  for (let index = 0; index < ACTIVE_POWERUP_COUNT; index += 1) {
    const defIndex = index === 0 ? 4 : 5;
    const def = POWERUP_DEFS[defIndex];
    const crystal = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: def.colour,
      emissive: def.emissive,
      emissiveIntensity: 1.85,
      roughness: 0.3,
      metalness: 0.08,
      flatShading: true,
      transparent: true,
      opacity: 0.96,
    });
    const shardAMaterial = material.clone();
    const shardBMaterial = material.clone();
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x132126, roughness: 1, flatShading: true });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xf6ffff, transparent: true, opacity: 0.76 });
    const bodyGeometry = new THREE.OctahedronGeometry(1.62, 0);
    const body = new THREE.Mesh(bodyGeometry, material);
    const bodyEdges = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeometry), edgeMaterial);
    const shardA = new THREE.Mesh(new THREE.OctahedronGeometry(0.72, 0), shardAMaterial);
    shardA.position.set(1.45, -0.25, 0.28);
    const shardB = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), shardBMaterial);
    shardB.position.set(-1.22, 0.48, -0.18);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.55, 0.9, 4, 1), darkMaterial);
    base.position.y = -1.55;
    base.rotation.y = index * 0.6 + 0.2;
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: def.colour, transparent: true, opacity: 0.42, depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.075, 4, 28), haloMaterial);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.5;
    const upperHalo = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.05, 4, 22), haloMaterial.clone());
    upperHalo.rotation.set(Math.PI / 2, 0.5, 0.22);
    upperHalo.position.y = 0.85;
    const light = new THREE.PointLight(def.colour, 3.4, 34, 2);
    light.position.y = 0.25;
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: def.colour, transparent: true, opacity: 0.2, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.72, 1, 6, 1, true), beamMaterial);
    const groundRingMaterial = new THREE.MeshBasicMaterial({
      color: def.colour, transparent: true, opacity: 0.62, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const groundRing = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.11, 4, 30), groundRingMaterial);
    groundRing.rotation.x = Math.PI / 2;
    const groundRing2 = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.06, 4, 26), groundRingMaterial.clone());
    groundRing2.rotation.x = Math.PI / 2;

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const labelContext = labelCanvas.getContext('2d');
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture, transparent: true, depthWrite: false, depthTest: false,
    }));
    label.position.y = 3.6;
    label.scale.set(8.6, 2.15, 1);
    label.renderOrder = 20;

    crystal.add(beam, groundRing, groundRing2, body, bodyEdges, shardA, shardB, base, halo, upperHalo, light, label);
    crystal.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    beam.castShadow = false;
    groundRing.castShadow = false;
    groundRing2.castShadow = false;
    scene.add(crystal);

    const anchor = INITIAL_POWERUP_ANCHORS[index % INITIAL_POWERUP_ANCHORS.length];
    const ground = heightAt(anchor.x, anchor.z);
    const initialHeight = index === 0 ? 9.4 : 10.6;
    const pos = { x: anchor.x, z: anchor.z, ground, y: ground + initialHeight };
    const powerup = {
      type: def.type, label: def.label, colour: def.colour,
      x: pos.x, z: pos.z, ground: pos.ground, y: pos.y,
      group: crystal, body, shardA, shardB, halo, upperHalo, light,
      beam, beamMaterial, groundRing, groundRing2, groundRingMaterial,
      label, labelCanvas, labelContext, labelTexture,
      crystalMaterials: [material, shardAMaterial, shardBMaterial],
      edgeMaterial, haloMaterial,
      born: simulationTime, phase: random() * TAU, typeCycle: defIndex,
    };
    applyPowerupStyle(powerup, def.type);
    updatePowerupBeaconGeometry(powerup);
    redrawPowerupLabel(powerup);
    powerups.push(powerup);
  }
}

function respawnPowerup(powerup, avoidPlayerIndex = -1) {
  powerup.typeCycle = (powerup.typeCycle + 2) % POWERUP_DEFS.length;
  applyPowerupStyle(powerup, POWERUP_DEFS[powerup.typeCycle].type);
  const pos = findPowerupSpawn(powerup, avoidPlayerIndex, avoidPlayerIndex, false);
  powerup.x = pos.x;
  powerup.z = pos.z;
  powerup.ground = pos.ground;
  powerup.y = pos.y;
  powerup.phase = random() * TAU;
  powerup.born = simulationTime;
  updatePowerupBeaconGeometry(powerup);
  redrawPowerupLabel(powerup);
}

function grantPower(playerIndex, type) {
  const p = players[playerIndex];
  if (type === 'shrink') p.powerTimers.grow = 0;
  if (type === 'grow') p.powerTimers.shrink = 0;
  p.powerTimers[type] = simulationTime + POWER_DURATION;
  p.lastPowerPickupType = type;
  p.powerOverlayFlashUntil = simulationTime + 0.75;
  const def = powerupDefinition(type);
  showSignal(`PLAYER ${playerIndex + 1} GAINED ${def.label}`, 3000);
  setBuildMessage(playerIndex, `${def.label} active for 60 seconds.`, 3.2);
  audioEngine.playPowerPickup?.(type);
  updatePowerupOverlays();
}

function updatePowerups(delta) {
  for (const powerup of powerups) {
    const bob = Math.sin(simulationTime * 1.35 + powerup.phase) * 0.78;
    powerup.group.rotation.y += delta * 0.62;
    powerup.group.rotation.z = Math.sin(simulationTime * 0.62 + powerup.phase) * 0.09;
    powerup.body.rotation.x += delta * 0.54;
    powerup.shardA.rotation.y -= delta * 1.05;
    powerup.shardB.rotation.x += delta * 1.2;
    powerup.halo.rotation.z += delta * 0.58;
    powerup.upperHalo.rotation.y -= delta * 0.76;
    powerup.groundRing.rotation.z += delta * 0.4;
    powerup.groundRing2.rotation.z -= delta * 0.27;
    powerup.halo.scale.setScalar(1 + Math.sin(simulationTime * 2.35 + powerup.phase) * 0.1);
    const beaconPulse = 0.72 + Math.sin(simulationTime * 2.7 + powerup.phase) * 0.18;
    powerup.beamMaterial.opacity = 0.14 + beaconPulse * 0.13;
    powerup.groundRingMaterial.opacity = 0.42 + beaconPulse * 0.28;
    powerup.groundRing2.material.opacity = 0.3 + beaconPulse * 0.22;
    powerup.light.intensity = 2.7 + Math.sin(simulationTime * 3.6 + powerup.phase) * 0.65;
    powerup.group.userData.renderYOffset = bob;

    const crystalY = powerup.y + bob;
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      const horizontal = Math.sqrt(wrappedDistanceSquared(powerup.x, powerup.z, p.position.x, p.position.z));
      const feet = p.position.y - playerEyeHeight(p);
      const playerTop = feet + playerHeight(p);
      const verticalGap = crystalY < feet ? feet - crystalY : crystalY > playerTop ? crystalY - playerTop : 0;
      if (horizontal <= POWERUP_PICKUP_RADIUS && verticalGap <= 1.25) {
        grantPower(i, powerup.type);
        respawnPowerup(powerup, i);
        break;
      }
    }
  }
}

function updatePowerupOverlays() {
  players.forEach((p, playerIndex) => {
    const overlay = document.querySelector(`#power-overlay-${playerIndex}`);
    if (!overlay) return;
    const cards = POWERUP_DEFS
      .filter((def) => playerHasPower(p, def.type))
      .sort((a, b) => (p.powerTimers[b.type] || 0) - (p.powerTimers[a.type] || 0))
      .map((def) => {
        const remaining = Math.max(0, (p.powerTimers[def.type] || 0) - simulationTime);
        const progress = THREE.MathUtils.clamp(remaining / POWER_DURATION, 0, 1) * 100;
        const colour = `#${def.colour.toString(16).padStart(6, '0')}`;
        return `<div class="power-card" style="--power-colour:${colour};--power-progress:${progress.toFixed(1)}%"><div class="power-card-header"><span>${def.label}</span><span class="power-card-time">${Math.ceil(remaining)}s</span></div><div class="power-card-bar"><span></span></div></div>`;
      });
    overlay.innerHTML = cards.join('');
    overlay.classList.toggle('pickup-flash', p.powerOverlayFlashUntil > simulationTime);
  });
}

function spawnExplosion(x, y, z, owner, charged, strength = 1) {
  const colour = charged ? 0xffd566 : (owner === 0 ? 0xff875d : 0x77f2df);
  const group = new THREE.Group();
  const ringMaterial = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide });
  const coreMaterial = new THREE.MeshBasicMaterial({ color: strength > 1.5 ? 0xffffff : 0xfff5d6, transparent: true, opacity: 0.92, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7,0.08,4,20),ringMaterial); ring.rotation.x=Math.PI/2;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.34,0),coreMaterial); group.add(ring,core);
  const shards=[], shardCount=Math.round(8+strength*6);
  for(let i=0;i<shardCount;i+=1){const mesh=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.16,0.16),new THREE.MeshBasicMaterial({color:colour,transparent:true,opacity:0.84,depthWrite:false}));const a=i/shardCount*TAU;mesh.position.set(Math.cos(a)*0.3,(i%3-1)*0.13,Math.sin(a)*0.3);group.add(mesh);shards.push(mesh);}
  group.scale.setScalar(0.9+strength*0.22); scene.add(group);
  explosionBursts.push({x,y,z,born:simulationTime,owner,charged,strength,group,ring,core,ringMaterial,coreMaterial,shards});
}

function removeExplosionAt(index) {
  const burst = explosionBursts[index];
  if (!burst) return;
  scene.remove(burst.group);
  burst.ring.geometry.dispose();
  burst.core.geometry.dispose();
  burst.ringMaterial.dispose();
  burst.coreMaterial.dispose();
  for (const shard of burst.shards) { shard.geometry.dispose(); shard.material.dispose(); }
  explosionBursts.splice(index, 1);
}

function triggerProjectileExplosion(shot, x, y, z, directPlayerIndex = -1, directNpcIndex = -1) {
  // Mark it immediately so the sub-stepped projectile loop cannot detonate the same cube twice.
  shot.stuck = true;
  const strength = shot.blastBoosted ? (shot.mega ? 3.15 : 2.5) : shot.mega ? 1.7 : 1;
  const radius = shot.blastBoosted ? (shot.mega ? 8.6 : 7.0) : shot.mega ? 5.1 : 3.35;
  spawnExplosion(x,y,z,shot.owner,shot.tagCharged,strength); audioEngine.playExplosion?.(shot.tagCharged);
  if(shot.mega||shot.blastBoosted) spawnTinyCubeBurst(shot,x,y,z,shot.blastBoosted?(shot.mega?30:22):12);

  let targetIndex=-1,bestScore=Infinity;
  for(let i=0;i<players.length;i+=1){
    const target=players[i],feet=target.position.y-playerEyeHeight(target),height=playerHeight(target);
    const horizontal=Math.sqrt(wrappedDistanceSquared(x,z,target.position.x,target.position.z));
    const vertical=Math.abs((feet+height*0.5)-y);

    // Powered ground shots create a controlled rocket-jump for the thrower. It is deliberately
    // weaker than receiving a direct fully charged hit from the other surveyor.
    if(i===shot.owner){
      if(shot.blastBoosted && horizontal<=radius*0.78 && vertical<=radius+1.4){
        const selfLift = shot.mega ? 34 : 29;
        target.verticalVelocity=Math.max(target.verticalVelocity,selfLift);
        target.grounded=false;
        setBuildMessage(i,'BLAST JUMP!',1.35);
      }
      continue;
    }

    const hit=i===directPlayerIndex||(horizontal<=radius&&vertical<=radius+0.8); if(!hit) continue;
    const score=horizontal+vertical*0.28; if(score<bestScore){bestScore=score;targetIndex=i;}
    if(shot.mega&&i===directPlayerIndex){target.verticalVelocity=Math.max(target.verticalVelocity,shot.blastBoosted?56:40);target.grounded=false;setBuildMessage(i,'The charged cube launched you into the air!',2.2);}
    else if(shot.blastBoosted&&horizontal<radius*0.78){target.verticalVelocity=Math.max(target.verticalVelocity,24+strength*5.5);target.grounded=false;}
  }

  // NPCs receive the same comic blast response and can be thrown visibly into the air.
  for(let i=0;i<npcVisuals.length;i+=1){
    const npc=npcVisuals[i];
    const horizontal=Math.sqrt(wrappedDistanceSquared(x,z,npc.x,npc.z));
    const vertical=Math.abs((npc.y+2.0)-y);
    const hit=i===directNpcIndex||(horizontal<=radius&&vertical<=radius+1.0);
    if(!hit) continue;
    const lift = i===directNpcIndex && shot.mega ? (shot.blastBoosted?48:36) : shot.blastBoosted ? 25+strength*5 : shot.mega ? 25 : 17;
    npc.verticalVelocity=Math.max(npc.verticalVelocity||0,lift);
    npc.airborne=true;
    npc.targetYaw += (random()-0.5)*1.7;
    npc.turnAt=simulationTime+1.4;
    if(i===directNpcIndex) setNpcChatter(npc,'WHOA');
  }

  if(shot.tagCharged&&targetIndex>=0){taggedPlayer=targetIndex;lastTagTransfer=simulationTime;showSignal(`${shot.mega?'CHARGED ':''}BLAST TAG — PLAYER ${targetIndex+1} HAS THE GLOW`,2800);audioEngine.playTagProjectileHit();updateTagHud();}
  const shotIndex=thrownCubes.indexOf(shot); if(shotIndex>=0) removeThrownCubeAt(shotIndex);
}

function updateExplosions(delta) {
  for (let i = explosionBursts.length - 1; i >= 0; i -= 1) {
    const burst = explosionBursts[i];
    const age = simulationTime - burst.born;
    if (age >= 0.85) { removeExplosionAt(i); continue; }
    const life = age / 0.85;
    const fade = 1 - life;
    const scale = 0.6 + life * (4.6 + (burst.strength || 1) * 1.6);
    burst.group.scale.setScalar(scale);
    burst.ringMaterial.opacity = 0.78 * fade;
    burst.coreMaterial.opacity = 0.92 * fade;
    burst.ring.rotation.z += delta * 3.8;
    burst.core.rotation.x += delta * 5.5;
    burst.core.rotation.y += delta * 4.4;
    burst.shards.forEach((shard, shardIndex) => {
      const a = shardIndex / burst.shards.length * TAU + age * 7;
      const radius = 0.4 + life * 2.1 + (shardIndex % 2) * 0.1;
      shard.position.set(Math.cos(a) * radius, Math.sin(age * 8 + shardIndex) * 0.35, Math.sin(a) * radius);
      shard.material.opacity = 0.8 * fade;
    });
  }
}


function beginThrowCharge(index, source = 'input') {
  if (currentGameMode !== 'survey' || !gameIsActive()) return false;
  const charge = throwCharges[index];
  if (charge.active) return false;
  charge.active = true; charge.started = simulationTime; charge.source = source;
  setBuildMessage(index, 'CHARGING CUBE… release to throw a large burst cube.', 1.2);
  return true;
}

function releaseThrowCharge(index) {
  if (currentGameMode !== 'survey') return false;
  const charge = throwCharges[index];
  if (!charge.active) return false;
  const held = Math.max(0, simulationTime - charge.started);
  charge.active = false; charge.source = '';
  const megaCharge = held >= 0.52 ? THREE.MathUtils.clamp((held - 0.52) / 1.35, 0.18, 1) : 0;
  return throwGlitterCube(index, megaCharge);
}

function spawnTinyCubeBurst(parentShot, x, y, z, count) {
  const burstRandom = mulberry32(parentShot.id * 991 + Math.floor(simulationTime * 1000));
  for (let i = 0; i < count; i += 1) {
    if (thrownCubes.length >= THROW_LIMIT) removeThrownCubeAt(0);
    const angle = (i / count) * TAU + burstRandom() * 0.35;
    const lift = -0.18 + burstRandom() * 0.72;
    const horizontal = Math.sqrt(Math.max(0.12, 1 - lift * lift));
    const dir = new THREE.Vector3(Math.cos(angle) * horizontal, lift, Math.sin(angle) * horizontal).normalize();
    const material = new THREE.MeshStandardMaterial({ color: parentShot.owner === 0 ? 0xffb36b : 0x7be9d1, emissive: parentShot.blastBoosted ? 0xffffff : (parentShot.owner === 0 ? 0xff6b2a : 0x41ddc3), emissiveIntensity: parentShot.blastBoosted ? 3.0 : 1.7, roughness: 0.4, flatShading: true, transparent: true, opacity: 1 });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: parentShot.blastBoosted ? 0xffffff : 0xfff1ba, transparent: true, opacity: 0.78 });
    const mesh = new THREE.Mesh(throwableGeometry, material);
    const edges = new THREE.LineSegments(throwableEdgeGeometry, edgeMaterial);
    const glitter = makeGlitterPoints(parentShot.owner);
    const group = new THREE.Group(); group.scale.setScalar(parentShot.blastBoosted ? 0.58 : 0.44); group.add(mesh, edges, glitter.points); scene.add(group);
    const speed = (parentShot.blastBoosted ? 42 : 28) * (0.7 + burstRandom() * 0.55);
    thrownCubes.push({ id: nextThrowableId++, owner: parentShot.owner, born: simulationTime, x, y, z, prevX: x, prevY: y, prevZ: z, vx: dir.x * speed, vy: dir.y * speed + 3.2, vz: dir.z * speed, gravity: parentShot.blastBoosted ? 8.5 : 12.5, radius: THROW_RADIUS * 0.55, stuck: false, attachedToPlayer: null, attachOffset: null, tagCharged: false, explosive: false, mega: false, blastBoosted: false, tiny: true, group, mesh, material, edgeMaterial, glitter: glitter.points, glitterGeometry: glitter.geometry, glitterMaterial: glitter.material, spinX: 3.1 + burstRandom() * 2, spinY: 2.8 + burstRandom() * 2 });
  }
}

function throwGlitterCube(index, chargeAmount = 0) {
  if (!gameIsActive()) return false;
  if (thrownCubes.length >= THROW_LIMIT) removeThrownCubeAt(0);
  const p = players[index];
  if (simulationTime - (p.lastThrowAt ?? -Infinity) < 0.22) return false;
  p.lastThrowAt = simulationTime;
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const dir = p.throwAim ? new THREE.Vector3(...p.throwAim).normalize() : new THREE.Vector3(-Math.sin(p.yaw) * cp, sp, -Math.cos(p.yaw) * cp).normalize();
  const origin = p.throwOrigin || [p.position.x, p.position.y - 0.08, p.position.z];
  const spawn = safeThrowOrigin(p, origin, dir);
  const x = spawn.x, y = spawn.y, z = spawn.z;
  const mega = chargeAmount > 0, blastBoosted = playerHasPower(p, 'blast'), explosive = blastBoosted || mega;
  const material = new THREE.MeshStandardMaterial({ color: index === 0 ? 0xffa85f : 0x65d7bf, emissive: index === 0 ? 0xff7229 : 0x3be6c0, emissiveIntensity: 2.2, roughness: 0.42, flatShading: true, transparent: true, opacity: 1 });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xfff0ad, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(throwableGeometry, material), edges = new THREE.LineSegments(throwableEdgeGeometry, edgeMaterial), glitter = makeGlitterPoints(index);
  const group = new THREE.Group(); group.name = `Glitter cube ${nextThrowableId}`; group.add(mesh, edges, glitter.points); scene.add(group);
  const runningMultiplier = p.isRunning ? 1.4 : 1;
  let speed = mega ? 46 + chargeAmount * 22 : 29.5;
  if (blastBoosted) speed = mega ? 150 + chargeAmount * 45 : 122;
  speed *= runningMultiplier;
  const tagCharged = index === taggedPlayer;
  group.scale.setScalar(mega ? 2.0 + chargeAmount * 1.45 : blastBoosted ? 1.24 : 1);
  if (blastBoosted) { material.color.setHex(index === 0 ? 0xff6f4d : 0x70eeff); material.emissive.setHex(0xffffff); material.emissiveIntensity = mega ? 5.2 : 4.2; edgeMaterial.color.setHex(0xffffff); }
  if (mega) {
    // Charged hold-fire cubes are deliberately hot orange so they read instantly at distance.
    material.color.setHex(blastBoosted ? 0xff5a1f : 0xff7a2d);
    material.emissive.setHex(blastBoosted ? 0xffd0a3 : 0xff3b08);
    material.emissiveIntensity = blastBoosted ? 5.5 : 4.1 + chargeAmount * 1.7;
    edgeMaterial.color.setHex(tagCharged ? 0xffffb5 : 0xffb24d);
  } else if (tagCharged) {
    material.color.setHex(0xffd45d); material.emissive.setHex(0xff9e24); material.emissiveIntensity = blastBoosted ? 5.6 : 3.6; edgeMaterial.color.setHex(0xffffd2);
  }
  thrownCubes.push({ id: nextThrowableId++, owner: index, born: simulationTime, x, y, z, prevX: x, prevY: y, prevZ: z, vx: dir.x * speed, vy: dir.y * speed + (blastBoosted ? 4.5 : mega ? 3.2 : 1.4), vz: dir.z * speed, gravity: blastBoosted ? 3.2 : mega ? 8.5 : 13.5, radius: THROW_RADIUS * (mega ? (2.2 + chargeAmount * 0.9) : blastBoosted ? 1.35 : 1), stuck: false, attachedToPlayer: null, attachOffset: null, tagCharged, explosive, mega, blastBoosted, group, mesh, material, edgeMaterial, glitter: glitter.points, glitterGeometry: glitter.geometry, glitterMaterial: glitter.material, spinX: mega ? 0.9 : 1.7 + index * 0.4, spinY: mega ? 1.2 : 2.3 - index * 0.25 });
  const label = mega ? (blastBoosted ? 'OVERCHARGED BLAST CUBE' : 'CHARGED BURST CUBE') : blastBoosted ? 'FAST EXPLOSIVE CUBE' : 'Glitter cube';
  setBuildMessage(index, `${label} thrown.${p.isRunning ? ' Running throw boosted.' : ''}`, 2.0);
  return true;
}

function removeThrownCubeAt(index) {
  const shot = thrownCubes[index];
  if (!shot) return;
  scene.remove(shot.group);
  shot.material.dispose();
  shot.edgeMaterial.dispose();
  shot.glitterGeometry.dispose();
  shot.glitterMaterial.dispose();
  thrownCubes.splice(index, 1);
}

function pointInsideTemporaryBlock(x, y, z, b, padding = THROW_RADIUS) {
  return Math.abs(wrappedDelta(x, b.x)) <= BLOCK_SIZE * 0.5 + padding &&
    Math.abs(wrappedDelta(z, b.z)) <= BLOCK_SIZE * 0.5 + padding &&
    y >= b.bottom - padding && y <= b.top + padding;
}

function projectileHitsPlayer(shot) {
  const age = simulationTime - shot.born;
  for (let playerIndex = 0; playerIndex < players.length; playerIndex += 1) {
    if (playerIndex === shot.owner && age < 0.24) continue;
    const target = players[playerIndex];
    const feet = target.position.y - playerEyeHeight(target);
    const height = playerHeight(target), radius = playerRadius(target);
    const shotRadius = shot.radius ?? THROW_RADIUS;
    if (shot.y < feet - shotRadius || shot.y > feet + height + shotRadius) continue;
    const horizontal = Math.sqrt(wrappedDistanceSquared(shot.x, shot.z, target.position.x, target.position.z));
    if (horizontal <= radius + shotRadius + 0.14) return playerIndex;
  }
  return -1;
}

function projectileHitsNPC(shot) {
  const shotRadius = shot.radius ?? THROW_RADIUS;
  for (let npcIndex = 0; npcIndex < npcVisuals.length; npcIndex += 1) {
    const npc = npcVisuals[npcIndex];
    if (shot.y < npc.y - shotRadius || shot.y > npc.y + 4.5 + shotRadius) continue;
    const horizontal = Math.sqrt(wrappedDistanceSquared(shot.x, shot.z, npc.x, npc.z));
    if (horizontal <= 0.72 + shotRadius) return npcIndex;
  }
  return -1;
}

function hitNPCWithProjectile(shot, npcIndex) {
  const npc = npcVisuals[npcIndex];
  if (!npc) return;
  if (shot.explosive) {
    triggerProjectileExplosion(shot, shot.x, shot.y, shot.z, -1, npcIndex);
    return;
  }
  // Ordinary small cubes simply stick at the impact point rather than deleting the NPC.
  stickProjectile(shot);
  setNpcChatter(npc, 'HEY');
}

function stickProjectileToPlayer(shot, playerIndex) {
  if (shot.explosive) {
    triggerProjectileExplosion(shot, shot.x, shot.y, shot.z, playerIndex);
    return;
  }
  const target = players[playerIndex];
  shot.stuck = true;
  shot.attachedToPlayer = playerIndex;
  shot.attachOffset = {
    x: wrappedDelta(shot.x, target.position.x),
    y: shot.y - (target.position.y - playerEyeHeight(target)),
    z: wrappedDelta(shot.z, target.position.z),
  };
  shot.vx = shot.vy = shot.vz = 0;
  shot.group.rotation.set((shot.id * 0.73) % 1.4, (shot.id * 1.17) % TAU, (shot.id * 0.41) % 1.2);

  if (shot.tagCharged && shot.owner === taggedPlayer && playerIndex !== shot.owner) {
    taggedPlayer = playerIndex;
    lastTagTransfer = simulationTime;
    showSignal(`CUBE TAG — PLAYER ${playerIndex + 1} HAS THE GLOW`, 2800);
    audioEngine.playTagProjectileHit();
    updateTagHud();
  } else {
    setBuildMessage(shot.owner, `Cube hit Player ${playerIndex + 1}.`, 1.8);
  }
}

function projectileHitsWorld(shot) {
  const shotRadius = shot.radius ?? THROW_RADIUS;
  const ground = heightAt(shot.x, shot.z);
  if (shot.y <= ground + shotRadius) { shot.y = ground + shotRadius; return true; }
  for (const b of temporaryBlocks) {
    if (pointInsideTemporaryBlock(shot.x, shot.y, shot.z, b)) return true;
  }
  for (const platform of levelPlatforms) {
    if (overlapsLevelPlatformXZ(shot.x, shot.z, platform, shotRadius) && shot.y >= platform.bottom - shotRadius && shot.y <= platform.top + shotRadius) return true;
  }
  for (const tree of treeColliders) {
    const d2 = wrappedDistanceSquared(shot.x, shot.z, tree.x, tree.z);
    const r = tree.radius + shotRadius;
    if (d2 < r * r) {
      const base = heightAt(tree.x, tree.z);
      if (shot.y > base - 0.2 && shot.y < base + 18) return true;
    }
  }
  for (const structure of structureColliders) {
    if (structure.kind === 'tower') {
      const towerIndex = structure.towerIndex;
      const building = buildingDefs[towerIndex];
      const base = towerBaseY(towerIndex);
      const localY = (shot.y - base) / building.scale;
      const hitsShaft = insideTowerRect(shot.x, shot.z, towerIndex, 5.5, 5.5, shotRadius) && localY >= -0.5 && localY <= 43.5;
      const hitsSlab = insideTowerRect(shot.x, shot.z, towerIndex, 23.5, 21.5, shotRadius) && localY >= 38.5 && localY <= 48;
      const hitsTop = insideTowerRect(shot.x, shot.z, towerIndex, 22, 20, shotRadius) && localY >= 47 && localY <= 74;
      if (hitsShaft || hitsSlab || hitsTop) return true;
      continue;
    }
    const d2 = wrappedDistanceSquared(shot.x, shot.z, structure.x, structure.z);
    const r = structure.radius + shotRadius;
    if (d2 < r * r) {
      const base = heightAt(structure.x, structure.z);
      if (shot.y > base - 0.5 && shot.y < base + 82) return true;
    }
  }
  return false;
}

function stickProjectile(shot) {
  if (shot.explosive) {
    triggerProjectileExplosion(shot, shot.prevX, shot.prevY, shot.prevZ, -1);
    return;
  }
  shot.stuck = true;
  shot.x = shot.prevX; shot.y = shot.prevY; shot.z = shot.prevZ;
  shot.vx = shot.vy = shot.vz = 0;
  shot.group.rotation.set((shot.id * 0.73) % 1.4, (shot.id * 1.17) % TAU, (shot.id * 0.41) % 1.2);
}

function updateThrownCubes(delta) {
  for (let i = thrownCubes.length - 1; i >= 0; i--) {
    const shot = thrownCubes[i];
    const age = simulationTime - shot.born;
    const remaining = THROW_LIFETIME - age;
    if (remaining <= 0) { removeThrownCubeAt(i); continue; }
    if (shot.attachedToPlayer !== null) {
      const target = players[shot.attachedToPlayer];
      if (target && shot.attachOffset) {
        shot.x = wrapWorld(target.position.x + shot.attachOffset.x);
        shot.y = target.position.y - playerEyeHeight(target) + shot.attachOffset.y;
        shot.z = wrapWorld(target.position.z + shot.attachOffset.z);
      }
    } else if (!shot.stuck) {
      const steps = Math.max(1, Math.ceil(delta * Math.hypot(shot.vx, shot.vy, shot.vz) / Math.max(0.04, (shot.radius || THROW_RADIUS) * 0.4)), Math.ceil(delta * 120));
      const dt = delta / steps;
      for (let n = 0; n < steps && !shot.stuck; n++) {
        shot.prevX = shot.x; shot.prevY = shot.y; shot.prevZ = shot.z;
        shot.vy -= (shot.gravity ?? 13.5) * dt;
        shot.x = wrapWorld(shot.x + shot.vx * dt);
        shot.y += shot.vy * dt;
        shot.z = wrapWorld(shot.z + shot.vz * dt);
        const hitPlayer = projectileHitsPlayer(shot);
        if (hitPlayer >= 0) stickProjectileToPlayer(shot, hitPlayer);
        else {
          const hitNpc = projectileHitsNPC(shot);
          if (hitNpc >= 0) hitNPCWithProjectile(shot, hitNpc);
          else if (projectileHitsWorld(shot)) stickProjectile(shot);
        }
      }
      if (!shot.stuck) {
        shot.group.rotation.x += delta * shot.spinX;
        shot.group.rotation.y += delta * shot.spinY;
      }
    }
    const fade = THREE.MathUtils.clamp(remaining / 4, 0, 1);
    shot.material.opacity = 0.18 + fade * 0.82;
    shot.edgeMaterial.opacity = 0.22 + fade * 0.68;
    shot.glitterMaterial.opacity = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(simulationTime * 9 + shot.id))) * fade;
    shot.glitter.rotation.y += delta * (shot.stuck ? 1.8 : 3.5);
    shot.glitter.rotation.x += delta * 0.7;
    const sparkle = 0.82 + Math.sin(simulationTime * 7.6 + shot.id) * 0.22;
    shot.glitter.scale.setScalar(sparkle);
  }
}

function buildConstruction() {
  blockGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, BLOCK_SIZE);
  blockEdgeGeometry = new THREE.EdgesGeometry(blockGeometry);
  blockBarGeometry = new THREE.BoxGeometry(BLOCK_SIZE * 0.82, 0.04, 0.055);
  for (let i = 0; i < 2; i++) {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0x9effd4, transparent: true, opacity: 0.13, depthWrite: false });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x9effd4, transparent: true, opacity: 0.85, depthWrite: false });
    group.add(new THREE.Mesh(blockGeometry, material), new THREE.LineSegments(blockEdgeGeometry, edgeMaterial));
    group.visible = false;
    scene.add(group);
    buildPreviews.push({ group, material, edgeMaterial });
  }
}

function overlapsBlockXZ(x, z, block, radius = PLAYER_RADIUS) {
  const dx = Math.max(Math.abs(wrappedDelta(x, block.x)) - BLOCK_SIZE * 0.5, 0);
  const dz = Math.max(Math.abs(wrappedDelta(z, block.z)) - BLOCK_SIZE * 0.5, 0);
  return dx * dx + dz * dz < radius * radius;
}

function setBuildMessage(index, text, seconds = 1.8) {
  buildMessages[index] = { text, until: simulationTime + seconds };
}

function findBuildCandidate(index) {
  const p = players[index];
  const fx = -Math.sin(p.buildYaw ?? p.yaw), fz = -Math.cos(p.buildYaw ?? p.yaw);
  const x = wrapWorld(Math.round((p.position.x + fx * 4.6) / BLOCK_SIZE) * BLOCK_SIZE);
  const z = wrapWorld(Math.round((p.position.z + fz * 4.6) / BLOCK_SIZE) * BLOCK_SIZE);
  // A fixed-height step just ahead makes stairs easy to extend while walking.
  // The last supporting surface is used in a jump, never the jumping camera.
  const level = p.grounded ? p.position.y - playerEyeHeight(p) : p.lastGroundHeight;
  let ground = heightAt(x, z);
  for (const dx of [-1.8, 1.8]) for (const dz of [-1.8, 1.8]) ground = Math.max(ground, heightAt(x + dx, z + dz));
  const bottom = Math.max(level, ground - 0.10);
  const result = { x, z, bottom, top: bottom + BLOCK_HEIGHT, valid: true, reason: 'Place a step ahead' };
  const reject = (reason) => { result.valid = false; result.reason = reason; return result; };
  if (temporaryBlocks.length >= BLOCK_LIMIT) return reject('Step limit reached. Older steps will fade soon.');
  if (result.top - (p.position.y - playerEyeHeight(p)) > playerStepHeight(p) + 0.04) return reject('Ground too steep. Try another direction.');
  for (const t of [...treeColliders, ...structureColliders]) {
    const dx = Math.max(Math.abs(wrappedDelta(x, t.x)) - BLOCK_SIZE * 0.5, 0);
    const dz = Math.max(Math.abs(wrappedDelta(z, t.z)) - BLOCK_SIZE * 0.5, 0);
    if (dx * dx + dz * dz < (t.radius + 0.12) ** 2) return reject('A tree or tower is in the way.');
  }
  for (const b of temporaryBlocks) {
    if (Math.abs(wrappedDelta(x, b.x)) < BLOCK_SIZE - 0.02 && Math.abs(wrappedDelta(z, b.z)) < BLOCK_SIZE - 0.02 &&
        result.bottom < b.top - 0.04 && result.top > b.bottom + 0.04) return reject('Step already here. Climb it to build higher.');
  }
  for (const platform of levelPlatforms) {
    if (overlapsLevelPlatformXZ(x, z, platform, BLOCK_SIZE * 0.48) && result.bottom < platform.top - 0.04 && result.top > platform.bottom + 0.04)
      return reject('A permanent structure is in the way.');
  }
  for (const other of players) {
    const feet = other.position.y - playerEyeHeight(other);
    if (overlapsBlockXZ(other.position.x, other.position.z, result, playerRadius(other) + 0.04) &&
        result.top > feet + 0.04 && result.bottom < feet + playerHeight(other)) return reject('A surveyor is in the way.');
  }
  return result;
}

function toggleBuild(index) {
  if (!gameIsActive()) return;
  players[index].building = !players[index].building;
  setBuildMessage(index, players[index].building ? 'Build mode on. Steps last 30 seconds.' : 'Build mode off.');
  updateBuildReadouts();
}

function placeBlock(index) {
  if (!gameIsActive()) return false;
  const p = players[index];
  p.building = true;
  if (simulationTime - p.lastPlacedAt < 0.28) return false;
  const candidate = findBuildCandidate(index);
  buildCandidates[index] = candidate;
  if (!candidate.valid) { setBuildMessage(index, candidate.reason); return false; }
  p.lastPlacedAt = simulationTime;
  const material = new THREE.MeshStandardMaterial({
    color: index === 0 ? 0x995842 : 0x3a6960,
    roughness: 0.91, flatShading: true, transparent: true, opacity: 1,
    emissive: index === 0 ? 0x582213 : 0x114339, emissiveIntensity: 0.15,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: index === 0 ? 0xffba83 : 0xa0ffdc,
    transparent: true, opacity: 0.68, depthWrite: false,
  });
  const barMaterial = new THREE.MeshBasicMaterial({ color: index === 0 ? 0xffc79a : 0xb6ffe7, transparent: true });
  const mesh = new THREE.Mesh(blockGeometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const edges = new THREE.LineSegments(blockEdgeGeometry, edgeMaterial);
  const bar = new THREE.Mesh(blockBarGeometry, barMaterial);
  bar.position.set(0, BLOCK_HEIGHT * 0.5 + 0.025, -BLOCK_SIZE * 0.34);
  const group = new THREE.Group();
  group.name = `Temporary step ${nextBlockId}`;
  group.add(mesh, edges, bar);
  scene.add(group);
  temporaryBlocks.push({ ...candidate, id: nextBlockId++, owner: index, born: simulationTime, group, mesh, material, edgeMaterial, bar, barMaterial });
  setBuildMessage(index, 'Step placed. 30 seconds.');
  updateBuildReadouts();
  return true;
}

function removeBlockAt(index) {
  const b = temporaryBlocks[index];
  scene.remove(b.group);
  b.material.dispose(); b.edgeMaterial.dispose(); b.barMaterial.dispose();
  // Geometry is shared by every block and both previews. Do not dispose it here.
  temporaryBlocks.splice(index, 1);
}

function updateConstruction() {
  for (let i = temporaryBlocks.length - 1; i >= 0; i--) {
    const b = temporaryBlocks[i];
    const remaining = BLOCK_LIFETIME - (simulationTime - b.born);
    if (remaining <= 0) { removeBlockAt(i); continue; }
    const fade = THREE.MathUtils.clamp(remaining / 5, 0, 1);
    b.material.opacity = 0.22 + fade * 0.78;
    b.mesh.castShadow = remaining > 1;
    b.edgeMaterial.opacity = 0.18 + fade * 0.50;
    b.barMaterial.opacity = 0.4 + fade * 0.6;
    b.bar.scale.x = remaining / BLOCK_LIFETIME;
  }
  players.forEach((p, i) => { buildCandidates[i] = p.building && gameIsActive() ? findBuildCandidate(i) : null; });
}

function prepareSharedObjects(viewPlayer, viewIndex) {
  avatarVisuals.forEach((avatar, i) => {
    avatar.root.visible = currentGameMode === 'survey' && i !== viewIndex;
    const p = players[i];
    avatar.root.position.set(viewPlayer.position.x + wrappedDelta(p.position.x, viewPlayer.position.x), p.position.y - playerEyeHeight(p),
      viewPlayer.position.z + wrappedDelta(p.position.z, viewPlayer.position.z));
    avatar.root.rotation.y = p.yaw;
    const distance = Math.sqrt(wrappedDistanceSquared(viewPlayer.position.x, viewPlayer.position.z, p.position.x, p.position.z));
    avatar.label.visible = distance < 90;
    avatar.label.material.opacity = THREE.MathUtils.clamp((90 - distance) / 30, 0, 1);
  });
  for (const b of temporaryBlocks) {
    b.group.position.set(viewPlayer.position.x + wrappedDelta(b.x, viewPlayer.position.x), b.bottom + BLOCK_HEIGHT * 0.5,
      viewPlayer.position.z + wrappedDelta(b.z, viewPlayer.position.z));
  }
  for (const platform of levelPlatforms) {
    platform.group.position.set(viewPlayer.position.x + wrappedDelta(platform.x, viewPlayer.position.x), platform.bottom + platform.height * 0.5,
      viewPlayer.position.z + wrappedDelta(platform.z, viewPlayer.position.z));
  }
  for (const npc of npcVisuals) {
    npc.root.position.set(viewPlayer.position.x + wrappedDelta(npc.x, viewPlayer.position.x), npc.y,
      viewPlayer.position.z + wrappedDelta(npc.z, viewPlayer.position.z));
    npc.root.rotation.y = npc.yaw;
    const d = Math.sqrt(wrappedDistanceSquared(viewPlayer.position.x, viewPlayer.position.z, npc.x, npc.z));
    npc.root.visible = d < 160;
  }
  for (const shot of thrownCubes) {
    shot.group.position.set(viewPlayer.position.x + wrappedDelta(shot.x, viewPlayer.position.x), shot.y,
      viewPlayer.position.z + wrappedDelta(shot.z, viewPlayer.position.z));
  }
  for (const powerup of powerups) {
    powerup.group.position.set(
      viewPlayer.position.x + wrappedDelta(powerup.x, viewPlayer.position.x),
      powerup.y + (powerup.group.userData.renderYOffset || 0),
      viewPlayer.position.z + wrappedDelta(powerup.z, viewPlayer.position.z),
    );
  }
  for (const burst of explosionBursts) {
    burst.group.position.set(viewPlayer.position.x + wrappedDelta(burst.x, viewPlayer.position.x), burst.y,
      viewPlayer.position.z + wrappedDelta(burst.z, viewPlayer.position.z));
  }
  buildPreviews.forEach((preview, i) => {
    const c = buildCandidates[i];
    preview.group.visible = i === viewIndex && !!c && gameIsActive();
    if (!preview.group.visible) return;
    preview.group.position.set(viewPlayer.position.x + wrappedDelta(c.x, viewPlayer.position.x), c.bottom + BLOCK_HEIGHT * 0.5,
      viewPlayer.position.z + wrappedDelta(c.z, viewPlayer.position.z));
    const colour = c.valid ? (i === 0 ? 0xffc38f : 0x98ffd1) : 0xff684e;
    preview.material.color.setHex(colour);
    preview.edgeMaterial.color.setHex(colour);
  });
  if (vehicleModeActive()) prepareVehicleObjects(viewPlayer, viewIndex, clock.elapsedTime);
}

function updateBuildReadouts() {
  players.forEach((p, i) => {
    const mode = document.querySelector(`#build-toggle-${i}`);
    const place = document.querySelector(`#place-block-${i}`);
    const jump = document.querySelector(`#touch-jump-${i}`);
    const throwButton = document.querySelector(`#throw-cube-${i}`);
    const status = document.querySelector(`#build-status-${i}`);
    if (!mode) return;
    if (vehicleModeActive()) {
      const state = vehicleStates[i];
      mode.hidden = true; place.hidden = true; jump.hidden = true; if (throwButton) throwButton.hidden = true;
      if (status) status.textContent = currentGameMode === 'race'
        ? `${Math.round(state.speed)} SPEED · LAP ${Math.min(state.lap,RACE_LAPS)}/${RACE_LAPS} · ${raceCheckpointStatus(state)}`
        : `${Math.round(state.speed)} SPEED · FREE FLY`;
      return;
    }
    mode.hidden = false;
    mode.textContent = p.building ? 'BUILD ON' : 'BUILD OFF';
    mode.setAttribute('aria-pressed', String(p.building));
    place.hidden = inputAssignments[i] !== 'touch' && !p.building;
    jump.hidden = inputAssignments[i] !== 'touch';
    if (throwButton) throwButton.hidden = inputAssignments[i] !== 'touch';
    const hint = inputAssignments[i] === 'keyboard' ? 'B/E build | F throw' : inputAssignments[i] === 'touch' ? 'BUILD / PLACE / THROW' : 'Y/X build | RB throw';
    const msg = buildMessages[i];
    let text = msg.until > simulationTime ? msg.text : p.building && buildCandidates[i] && !buildCandidates[i].valid ? buildCandidates[i].reason : hint;
    const feet = p.position.y - playerEyeHeight(p);
    const supporting = temporaryBlocks.filter((b) => Math.abs(b.top - feet) < 0.09 && overlapsBlockXZ(p.position.x, p.position.z, b));
    if (supporting.length) {
      const left = Math.ceil(Math.min(...supporting.map((b) => BLOCK_LIFETIME - (simulationTime - b.born))));
      text = `Underfoot: ${left}s | ${hint}`;
    }
    const powerText = activePowerSummary(p);
    if (powerText) text = `${text} | ${powerText}`;
    if (powerups.length) {
      const nearestCrystal = Math.round(Math.min(...powerups.map((powerup) =>
        Math.sqrt(wrappedDistanceSquared(p.position.x, p.position.z, powerup.x, powerup.z)))));
      text = `${text} | CRYSTAL ${nearestCrystal}m`;
    }
    status.textContent = text;
    status.classList.toggle('expiring', supporting.some((b) => simulationTime - b.born > 25) || Object.values(p.powerTimers || {}).some((until) => until - simulationTime < 10 && until > simulationTime));
  });
}

function resetInputs() {
  for (const key of Object.keys(keys)) keys[key] = false;
  dragLooking = false;
  for (const touch of touchControls) {
    for (const id of [touch.movePointerId, touch.lookPointerId]) {
      if (id !== null && renderer.domElement.hasPointerCapture?.(id)) renderer.domElement.releasePointerCapture(id);
    }
    Object.assign(touch, makeTouchControl());
  }
  players.forEach((p) => { p.walkAmount = 0; p.jumpRequested = false; p.isRunning = false; });
  throwCharges.forEach((charge) => { charge.active = false; charge.started = 0; charge.source = ''; });
  inputAssignments.forEach((assignment, i) => {
    const pad = gamepadForAssignment(assignment);
    gamepadButtonState[i] = pad ? pad.buttons.map((b) => b.pressed) : [];
  });
}


const shipVisuals = [];
const raceCheckpoints = [];
const vehiclePowerups = [];
const vehicleStates = [
  { speed: 0, roll: 0, nextCheckpoint: 1, lap: 1, finished: false, finishTime: 0, lastThrottle: 0, powerTimers: { turbo: 0, lift: 0, handling: 0, overdrive: 0 } },
  { speed: 0, roll: 0, nextCheckpoint: 1, lap: 1, finished: false, finishTime: 0, lastThrottle: 0, powerTimers: { turbo: 0, lift: 0, handling: 0, overdrive: 0 } },
];
const RACE_LAPS = 3;
let raceWinner = -1;

function vehicleModeActive() { return currentGameMode === 'race' || currentGameMode === 'freefly'; }

function raceCheckpointStatus(state) {
  if (!raceCheckpoints.length) return 'NO GATES';
  return state.nextCheckpoint === 0 ? 'FINISH GATE' : `CP ${state.nextCheckpoint}/${raceCheckpoints.length - 1}`;
}

function makeShip(index) {
  const group = new THREE.Group();
  group.name = `Surveyor ship ${index + 1}`;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: index === 0 ? 0xb24b32 : 0x277167,
    emissive: index === 0 ? 0x4b130d : 0x0b342f,
    emissiveIntensity: 0.45,
    roughness: 0.72,
    flatShading: true,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x07191c, roughness: 0.9, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ color: index === 0 ? 0xffad63 : 0x7affdf, transparent: true, opacity: 0.92 });

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.72, 3.4, 4, 1), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.65;
  group.add(nose);

  const core = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.62, 2.5), bodyMat);
  core.position.z = 0.7;
  core.rotation.x = 0.04;
  group.add(core);

  const cockpit = new THREE.Mesh(new THREE.OctahedronGeometry(0.58, 0), darkMat);
  cockpit.scale.set(1.05, 0.55, 1.15);
  cockpit.position.set(0, 0.48, -0.2);
  group.add(cockpit);

  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0,0,0,  2.5,-0.05,1.1,  0.55,0,-1.05,
    0,0,0, -2.5,-0.05,1.1, -0.55,0,-1.05,
  ],3));
  wingGeo.computeVertexNormals();
  const wings = new THREE.Mesh(wingGeo, bodyMat);
  wings.position.y = -0.05;
  group.add(wings);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 1.15), darkMat);
  tail.position.set(0,0.5,1.45);
  tail.rotation.x = -0.16;
  group.add(tail);

  const thrusterL = new THREE.Mesh(new THREE.BoxGeometry(0.34,0.34,0.8), glowMat.clone());
  const thrusterR = new THREE.Mesh(new THREE.BoxGeometry(0.34,0.34,0.8), glowMat.clone());
  thrusterL.position.set(-0.58,-0.12,1.9); thrusterR.position.set(0.58,-0.12,1.9);
  group.add(thrusterL, thrusterR);

  const light = new THREE.PointLight(index === 0 ? 0xff8a4f : 0x57ffd9, 2.4, 12, 2);
  light.position.set(0,-0.1,2.0);
  group.add(light);
  group.traverse((o)=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  group.scale.setScalar(1.32);
  scene.add(group);
  return { group, bodyMat, glowMats:[thrusterL.material, thrusterR.material], light };
}

function raceSurfaceHeight(x,z){
  let y = heightAt(x,z);
  for (const platform of levelPlatforms) if (overlapsLevelPlatformXZ(x,z,platform,0)) y = Math.max(y, platform.top);
  return y;
}

function makeCheckpointLabel(index) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 72;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(3,18,22,0.78)'; ctx.fillRect(0,0,256,72);
    ctx.fillStyle = '#dffff6'; ctx.font = 'bold 28px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(index === 0 ? 'START / FINISH' : `CHECKPOINT ${index}`,128,37);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,depthTest:false}));
  sprite.position.y = 10.4; sprite.scale.set(8.2,2.3,1); sprite.renderOrder = 25;
  return sprite;
}

function buildRaceCourse(){
  const count = currentLevel === 'skyline' ? 20 : currentLevel === 'city' ? 18 : 16;
  const radiusBase = currentLevel === 'city' ? 145 : currentLevel === 'mountains' ? 155 : 132;
  for(let i=0;i<count;i++){
    const a = -Math.PI*0.55 + i/count*TAU;
    const radius = radiusBase + Math.sin(i*1.7)*18 + Math.cos(i*0.71)*8;
    const x = wrapWorld(Math.cos(a)*radius);
    const z = wrapWorld(Math.sin(a)*radius);
    let y = raceSurfaceHeight(x,z) + (currentLevel === 'mountains' ? 22 : 15) + Math.sin(i*1.23)*7;
    y = Math.max(y, 10);
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color:0x5d8d83, transparent:true, opacity:0.36, depthWrite:false, blending:THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.4,0.52,6,32), mat);
    const innerMat = new THREE.MeshBasicMaterial({ color:0xe7fff5, transparent:true, opacity:0.12, side:THREE.DoubleSide, depthWrite:false, blending:THREE.AdditiveBlending });
    const inner = new THREE.Mesh(new THREE.RingGeometry(6.7,7.05,30), innerMat);
    const pylonGeo = new THREE.BoxGeometry(0.48,18,0.48);
    const pylonL = new THREE.Mesh(pylonGeo, mat), pylonR = new THREE.Mesh(pylonGeo, mat);
    pylonL.position.set(-9.5,-0.4,0); pylonR.position.set(9.5,-0.4,0);
    const capL = new THREE.Mesh(new THREE.OctahedronGeometry(0.9,0), mat), capR = new THREE.Mesh(new THREE.OctahedronGeometry(0.9,0), mat);
    capL.position.set(-9.5,8.8,0); capR.position.set(9.5,8.8,0);
    const label = makeCheckpointLabel(i);
    group.add(ring,inner,pylonL,pylonR,capL,capR,label);
    scene.add(group);
    raceCheckpoints.push({x,z,y,group,ring,inner,pylonL,pylonR,capL,capR,label,mat,innerMat,phase:i*0.7});
  }
  for(let i=0;i<raceCheckpoints.length;i++){
    const cp=raceCheckpoints[i], next=raceCheckpoints[(i+1)%raceCheckpoints.length];
    const dx=wrappedDelta(next.x,cp.x), dz=wrappedDelta(next.z,cp.z);
    cp.group.rotation.y = Math.atan2(dx,dz);
    const dy=next.y-cp.y, flat=Math.hypot(dx,dz);
    cp.group.rotation.x = -Math.atan2(dy,flat)*0.35;
  }
}

const VEHICLE_POWER_DEFS = [
  {type:'turbo',label:'TURBO',colour:0xff6a45},
  {type:'lift',label:'LIFT',colour:0x68ffd2},
  {type:'handling',label:'AGILITY',colour:0x69a7ff},
  {type:'overdrive',label:'OVERDRIVE',colour:0xd47cff},
];

function vehiclePowerActive(state,type){ return (state.powerTimers?.[type]||0) > simulationTime; }
function vehiclePowerSummary(state){
  return VEHICLE_POWER_DEFS.filter(d=>vehiclePowerActive(state,d.type)).map(d=>`${d.label} ${Math.ceil(state.powerTimers[d.type]-simulationTime)}s`).join(' · ');
}

function setVehiclePickupPosition(pickup, seedOffset=0){
  if(currentGameMode==='race' && raceCheckpoints.length){
    const idx=(pickup.slot*3 + pickup.respawns*5 + seedOffset + 2)%raceCheckpoints.length;
    const a=raceCheckpoints[idx], b=raceCheckpoints[(idx+1)%raceCheckpoints.length];
    pickup.x=wrapWorld(a.x+wrappedDelta(b.x,a.x)*0.48);
    pickup.z=wrapWorld(a.z+wrappedDelta(b.z,a.z)*0.48);
    pickup.y=(a.y+b.y)*0.5 + 1.4;
  } else {
    const angle=(pickup.slot/(currentGameMode==='race'?6:5))*TAU + pickup.respawns*1.17 + seedOffset*0.31;
    const radius=58 + ((pickup.slot*37 + pickup.respawns*19)%75);
    pickup.x=wrapWorld(Math.cos(angle)*radius);
    pickup.z=wrapWorld(Math.sin(angle)*radius);
    pickup.y=raceSurfaceHeight(pickup.x,pickup.z)+16+((pickup.slot*11)%18);
  }
}

function buildVehiclePowerups(){
  const count=currentGameMode==='race'?6:5;
  for(let i=0;i<count;i++){
    const def=VEHICLE_POWER_DEFS[i%VEHICLE_POWER_DEFS.length];
    const group=new THREE.Group();
    const mat=new THREE.MeshStandardMaterial({color:def.colour,emissive:def.colour,emissiveIntensity:2.2,roughness:0.35,flatShading:true,transparent:true,opacity:0.95});
    const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(1.35,0),mat);
    crystal.scale.set(1,1.5,1);
    const ringMat=new THREE.MeshBasicMaterial({color:def.colour,transparent:true,opacity:0.52,depthWrite:false,blending:THREE.AdditiveBlending});
    const ring=new THREE.Mesh(new THREE.TorusGeometry(2.15,0.09,4,24),ringMat); ring.rotation.x=Math.PI/2;
    const ring2=new THREE.Mesh(new THREE.TorusGeometry(1.5,0.06,4,20),ringMat.clone()); ring2.rotation.set(Math.PI/2,0.6,0.2);
    const light=new THREE.PointLight(def.colour,3.2,24,2);
    group.add(crystal,ring,ring2,light); scene.add(group);
    const pickup={slot:i,type:def.type,label:def.label,colour:def.colour,group,crystal,ring,ring2,light,respawns:0,phase:i*1.3,x:0,y:0,z:0};
    vehiclePowerups.push(pickup); setVehiclePickupPosition(pickup,i);
  }
}

function grantVehiclePower(index,type){
  const state=vehicleStates[index], p=players[index];
  state.powerTimers[type]=simulationTime+60;
  if(type==='turbo') state.speed=Math.max(state.speed,78);
  if(type==='overdrive') state.speed=Math.max(state.speed,94);
  if(type==='lift') p.position.y=Math.min(240,p.position.y+20);
  const def=VEHICLE_POWER_DEFS.find(d=>d.type===type);
  showSignal(`PLAYER ${index+1} · ${def?.label||'POWER'} ACTIVE`,2200);
  audioEngine.playPowerPickup?.(type==='turbo'?'speed':type==='lift'?'jump':type==='handling'?'fly':'blast');
}

function updateVehiclePowerups(delta){
  for(const pickup of vehiclePowerups){
    pickup.group.rotation.y+=delta*1.25;
    pickup.crystal.rotation.x+=delta*0.8;
    pickup.ring.rotation.z+=delta*0.9;
    pickup.ring2.rotation.y-=delta*1.1;
    const pulse=1+Math.sin(simulationTime*4+pickup.phase)*0.12;
    pickup.group.scale.setScalar(pulse);
    pickup.light.intensity=2.7+Math.sin(simulationTime*5+pickup.phase)*0.8;
    for(let i=0;i<players.length;i++){
      const p=players[i], dx=wrappedDelta(p.position.x,pickup.x), dz=wrappedDelta(p.position.z,pickup.z), dy=p.position.y-pickup.y;
      if(dx*dx+dy*dy+dz*dz<6.4*6.4){
        grantVehiclePower(i,pickup.type);
        pickup.respawns+=1;
        pickup.type=VEHICLE_POWER_DEFS[(pickup.slot+pickup.respawns)%VEHICLE_POWER_DEFS.length].type;
        const def=VEHICLE_POWER_DEFS.find(d=>d.type===pickup.type);
        pickup.label=def.label; pickup.colour=def.colour;
        pickup.crystal.material.color.setHex(def.colour); pickup.crystal.material.emissive.setHex(def.colour);
        pickup.ring.material.color.setHex(def.colour); pickup.ring2.material.color.setHex(def.colour); pickup.light.color.setHex(def.colour);
        setVehiclePickupPosition(pickup,i+pickup.respawns);
        break;
      }
    }
  }
}

function resetVehicleStarts(){
  vehicleStates.forEach((state)=>Object.assign(state,{speed:currentGameMode==='race'?16:0,roll:0,nextCheckpoint:1,lap:1,finished:false,finishTime:0,lastThrottle:0,powerTimers:{turbo:0,lift:0,handling:0,overdrive:0}}));
  raceWinner=-1;
  if(currentGameMode==='race' && raceCheckpoints.length){
    const start=raceCheckpoints[0], next=raceCheckpoints[1];
    const dx=wrappedDelta(next.x,start.x), dz=wrappedDelta(next.z,start.z);
    const yaw=Math.atan2(-dx,-dz);
    players.forEach((p,i)=>{
      const side=i===0?-2.2:2.2;
      p.position.set(wrapWorld(start.x + Math.cos(yaw)*side), start.y, wrapWorld(start.z - Math.sin(yaw)*side));
      p.yaw=yaw; p.pitch=THREE.MathUtils.clamp(Math.atan2(next.y-start.y,Math.hypot(dx,dz)),-0.35,0.35);
      p.distance=0; p.loop=1; p.grounded=false; p.verticalVelocity=0;
    });
  } else {
    players.forEach((p,i)=>{
      const ground=heightAt(p.position.x,p.position.z);
      p.position.y=ground+12+i*1.5; p.pitch=0.05; p.grounded=false; p.verticalVelocity=0;
    });
  }
}

function buildVehicleSystem(){
  shipVisuals.push(makeShip(0),makeShip(1));
  if(currentGameMode==='race') buildRaceCourse();
  resetVehicleStarts();
  buildVehiclePowerups();
}

function updateVehiclePlayer(delta,index){
  const p=players[index], state=vehicleStates[index];
  const input=inputForPlayer(index,delta);
  const handlingBoost = vehiclePowerActive(state,'handling') ? 1.42 : 1;
  const liftBoost = vehiclePowerActive(state,'lift') ? 1.28 : 1;
  const turboBoost = vehiclePowerActive(state,'turbo') ? 1.34 : 1;
  const overdriveBoost = vehiclePowerActive(state,'overdrive') ? 1.62 : 1;
  p.pitch=THREE.MathUtils.clamp(p.pitch,-0.84,0.84);
  p.yaw -= input.side * 1.7 * handlingBoost * delta;
  state.roll = THREE.MathUtils.damp(state.roll, -input.side*0.55*handlingBoost, 7, delta);
  const boosting = input.sprint || (input.forward > 0.92 && inputAssignments[index] === 'touch');
  const baseMaxSpeed = currentGameMode==='race' ? (boosting?82:64) : (boosting?74:56);
  const maxSpeed = baseMaxSpeed * turboBoost * overdriveBoost;
  const accel = (currentGameMode==='race' ? 42 : 34) * (vehiclePowerActive(state,'turbo')?1.3:1) * (vehiclePowerActive(state,'overdrive')?1.48:1);
  if(input.forward>0.02) state.speed += input.forward*accel*delta;
  else if(input.forward<-0.02) state.speed -= (34 + Math.abs(input.forward)*26)*delta;
  else state.speed -= 5.2*delta;
  state.speed = THREE.MathUtils.clamp(state.speed,0,maxSpeed);
  state.lastThrottle=input.forward;

  const cp=Math.cos(p.pitch), sp=Math.sin(p.pitch);
  const dirX=-Math.sin(p.yaw)*cp, dirY=sp*liftBoost, dirZ=-Math.cos(p.yaw)*cp;
  const travelled=state.speed*delta;
  moveShipWithCollision(p, state, dirX * travelled, dirY * travelled, dirZ * travelled);
  p.distance += travelled;

  if(currentGameMode==='race' && !state.finished && raceCheckpoints.length){
    const cpnt=raceCheckpoints[state.nextCheckpoint];
    const dx=wrappedDelta(p.position.x,cpnt.x), dz=wrappedDelta(p.position.z,cpnt.z), dy=p.position.y-cpnt.y;
    if(dx*dx+dy*dy+dz*dz<11.5*11.5){
      const hit=state.nextCheckpoint;
      state.nextCheckpoint=(state.nextCheckpoint+1)%raceCheckpoints.length;
      if(hit===0){
        state.lap+=1;
        if(state.lap>RACE_LAPS){
          state.finished=true; state.finishTime=simulationTime;
          if(raceWinner<0){ raceWinner=index; showSignal(`PLAYER ${index+1} WINS THE RACE`,4200); }
          else showSignal(`PLAYER ${index+1} FINISHES`,2500);
        } else showSignal(`PLAYER ${index+1} · LAP ${state.lap}/${RACE_LAPS}`,1800);
      } else if(hit%4===0) showSignal(`PLAYER ${index+1} · CHECKPOINT ${hit}/${raceCheckpoints.length-1}`,1200);
    }
  }
}

function updateVehicles(delta,time){
  updateVehiclePlayer(delta,0); updateVehiclePlayer(delta,1);
  updateVehiclePowerups(delta);
  shipVisuals.forEach((ship,i)=>{
    const state=vehicleStates[i];
    const powered = vehiclePowerActive(state,'turbo') || vehiclePowerActive(state,'overdrive');
    const pulse=0.75+THREE.MathUtils.clamp(state.speed/90,0,1)*0.9+Math.sin(time*15+i)*0.12+(powered?0.32:0);
    ship.glowMats.forEach((m)=>m.opacity=THREE.MathUtils.clamp(pulse,0.55,1));
    ship.light.intensity=2.2+state.speed*0.045+(powered?2.2:0);
  });
}

function prepareVehicleObjects(viewPlayer,viewIndex,time){
  shipVisuals.forEach((ship,i)=>{
    const p=players[i], state=vehicleStates[i];
    ship.group.visible=true;
    ship.group.position.set(viewPlayer.position.x+wrappedDelta(p.position.x,viewPlayer.position.x),p.position.y,viewPlayer.position.z+wrappedDelta(p.position.z,viewPlayer.position.z));
    ship.group.rotation.order='YXZ';
    ship.group.rotation.set(p.pitch,p.yaw,state.roll,'YXZ');
    const bob=Math.sin(time*5+i*2.4)*0.08*(1-Math.min(1,state.speed/30));
    ship.group.position.y+=bob;
  });
  raceCheckpoints.forEach((cp,i)=>{
    cp.group.visible=currentGameMode==='race';
    if(!cp.group.visible)return;
    cp.group.position.set(viewPlayer.position.x+wrappedDelta(cp.x,viewPlayer.position.x),cp.y,viewPlayer.position.z+wrappedDelta(cp.z,viewPlayer.position.z));
    const active=i===vehicleStates[viewIndex].nextCheckpoint;
    cp.mat.color.setHex(active?0xffd15c:0x5c9e91);
    cp.mat.opacity=active?0.98:0.32;
    cp.innerMat.color.setHex(active?0xfff3ad:0xa6fff0);
    cp.innerMat.opacity=active?0.48:0.12;
    cp.label.visible=active || Math.sqrt(wrappedDistanceSquared(viewPlayer.position.x,viewPlayer.position.z,cp.x,cp.z))<80;
    const s=active?1.08+Math.sin(time*5+cp.phase)*0.08:1;
    cp.group.scale.setScalar(s);
  });
  for(const pickup of vehiclePowerups){
    pickup.group.visible=true;
    pickup.group.position.set(viewPlayer.position.x+wrappedDelta(pickup.x,viewPlayer.position.x),pickup.y,viewPlayer.position.z+wrappedDelta(pickup.z,viewPlayer.position.z));
  }
}

function setVehicleCamera(viewCamera,p,state){
  const cp=Math.cos(p.pitch), sp=Math.sin(p.pitch);
  const dir=new THREE.Vector3(-Math.sin(p.yaw)*cp,sp,-Math.cos(p.yaw)*cp);
  const behind=10.5+Math.min(5,state.speed*0.055);
  viewCamera.position.set(p.position.x-dir.x*behind,p.position.y-dir.y*behind+3.2,p.position.z-dir.z*behind);
  const target=new THREE.Vector3(p.position.x+dir.x*8,p.position.y+dir.y*8+0.7,p.position.z+dir.z*8);
  viewCamera.up.set(0,1,0);
  viewCamera.lookAt(target);
  viewCamera.rotateZ(state.roll*0.18);
  viewCamera.fov=72+Math.min(12,state.speed*0.12);
}

const clock = new THREE.Clock();
let readoutTimer = 0;

function renderSplitScreen(time) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const leftWidth = Math.floor(width * 0.5);
  const rightWidth = width - leftWidth;
  const views = [
    { player: players[0], camera, x: 0, width: leftWidth },
    { player: players[1], camera: camera2, x: leftWidth, width: rightWidth },
  ];

  renderer.setScissorTest(true);
  for (const view of views) {
    prepareWorldForPlayer(view.player, time);
    prepareSharedObjects(view.player, players.indexOf(view.player));
    if (vehicleModeActive()) setVehicleCamera(view.camera, view.player, vehicleStates[players.indexOf(view.player)]);
    else {
      view.camera.position.copy(view.player.position);
      view.camera.position.y += view.player.stepViewOffset || 0;
      view.camera.rotation.set(view.player.pitch, view.player.yaw, 0, 'YXZ');
      view.camera.fov = 72;
    }
    view.camera.aspect = Math.max(0.25, view.width / height);
    view.camera.updateProjectionMatrix();
    renderer.setViewport(view.x, 0, view.width, height);
    renderer.setScissor(view.x, 0, view.width, height);
    renderer.render(scene, view.camera);
  }
  renderer.setScissorTest(false);
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  pollMenuGamepads();
  if (gameIsActive()) {
    simulationTime += delta;
    if (vehicleModeActive()) {
      updateVehicles(delta,time);
      updateNPCSurveyors(delta);
    } else {
      updateConstruction();
      updatePlayer(delta, 0);
      updatePlayer(delta, 1);
      updateTowerRoofEffects(delta);
      updatePowerups(delta);
      updateThrownCubes(delta);
      updateExplosions(delta);
      updateNPCSurveyors(delta);
      updateSurveyors(delta, simulationTime);
    }
  }
  if (!vehicleModeActive()) updateConstruction();
  updateWorld(time);
  readoutTimer += delta;
  if (readoutTimer > 0.12) {
    updateReadouts();
    updateBuildReadouts();
    if (!vehicleModeActive()) updatePowerupOverlays();
    readoutTimer = 0;
  }
  renderSplitScreen(time);
  requestAnimationFrame(animate);
}

async function initialise() {
  try {
    buildRenderer();
    buildScene();
    bindEvents();
    worldReady = true;
    ui.enter.disabled = false;
    if (isTouchDevice) { ui.player1Input.value = 'touch'; ui.player2Input.value = 'touch'; }
    validateInputSelections();
    updateLevelDescription();
    updateGamepadStatus();
    ui.loading.classList.add('ready');
    animate();
  } catch (error) {
    console.error(error);
    showFatalError();
  }
}

// Bootstrap belongs to client.js and simulation.mjs.

    
