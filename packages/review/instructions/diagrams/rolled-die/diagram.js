// A die rolled across a table, drawn by three.js. Every pose is a pure
// function of time, so the player can jump to any moment, either way.
const THREE = await wb.three();

const WIDTH = 720;

const HEIGHT = 360;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

renderer.setPixelRatio(devicePixelRatio);

renderer.setSize(WIDTH, HEIGHT);

renderer.shadowMap.enabled = true;

renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// The scene goes in its place in diagram.html, under the result.
document.querySelector(".scene").prepend(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 0.1, 100);

camera.position.set(0, 7.5, 6.5);

camera.lookAt(0, 0.3, 0.3);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.6));

const sun = new THREE.DirectionalLight(0xffffff, 2.2);

sun.position.set(-3, 8, 4);

sun.castShadow = true;

sun.shadow.mapSize.set(1024, 1024);

sun.shadow.radius = 6;

Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });

scene.add(sun);

// The table only shows the die's shadow, so it reads on light and dark.
const table = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.ShadowMaterial({ opacity: 0.18 }),
);

table.rotation.x = -Math.PI / 2;

table.receiveShadow = true;

scene.add(table);

// Faces drawn on canvases. Opposite faces add up to seven; five is on top
// when the die is unrotated, which is how it lands.
const PIPS = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.27, 0.24],
    [0.73, 0.24],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.76],
    [0.73, 0.76],
  ],
};

const face = (count) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fbfbf8";
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = count === 1 ? "#d8402c" : "#15181e";

  for (const [x, y] of PIPS[count]) {
    context.beginPath();
    context.arc(x * 256, y * 256, count === 1 ? 30 : 22, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45 });
};

// Box faces in three.js order: +x, -x, +y, -y, +z, -z.
const die = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  [3, 4, 5, 2, 1, 6].map(face),
);

die.castShadow = true;

scene.add(die);

// The result, shown once the die is still.
const result = document.querySelector(".result");

const clamp = (value) => Math.min(Math.max(value, 0), 1);

const easeOut = (p) => 1 - (1 - p) ** 3;

const lerp = (a, b, p) => a + (b - a) * p;

// A hop from height `from` to `to` that peaks `lift` above the higher end.
const arc = (from, to, lift, p) => {
  const top = Math.max(from, to) + lift;

  return p < 0.5
    ? lerp(from, top, 1 - (1 - p * 2) ** 2)
    : lerp(top, to, ((p - 0.5) * 2) ** 2);
};

const REST = 0.5;

// Whole turns left to spin out, so the die ends with five up.
const SPIN = { x: Math.PI * 8, z: Math.PI * 4, y: Math.PI * 2 };

const pose = (time) => {
  const [shake, toss, bounce, settle] = wb.chapters.map(
    (chapter) => chapter.duration,
  );

  const t1 = shake;
  const t2 = t1 + toss;
  const t3 = t2 + bounce;
  const t4 = t3 + settle;

  // How much spin is left: all of it until the throw, none once settled.
  const spun = easeOut(clamp((time - t1) / (t4 - t1)));
  let x;
  let y;
  let wobble = 0;

  if (time < t1) {
    // Shaken in the hand, above the table on the left.
    const p = time / shake;
    x = -3 + Math.sin(p * Math.PI * 6) * 0.08;
    y = 1.8 + Math.abs(Math.sin(p * Math.PI * 6)) * 0.15;
    wobble = Math.sin(p * Math.PI * 10) * 0.3;
  } else if (time < t2) {
    const p = (time - t1) / toss;
    x = lerp(-3, -1.2, p);
    y = arc(1.8, REST, 0.6, p);
  } else if (time < t3) {
    // Two bounces, each lower than the last.
    const p = (time - t2) / bounce;
    x = lerp(-1.2, 0.7, p);
    y =
      p < 0.6
        ? arc(REST, REST, 0.9, p / 0.6)
        : arc(REST, REST, 0.3, (p - 0.6) / 0.4);
  } else {
    const p = clamp((time - t3) / settle);
    x = lerp(0.7, 1.1, easeOut(p));
    y = REST;
  }

  return {
    x,
    y,
    rx: SPIN.x * (1 - spun) + wobble,
    // A quarter-turn short of square, so two side faces show at rest.
    ry: SPIN.y * (1 - spun) + 0.45,
    rz: SPIN.z * (1 - spun) - wobble * 0.5,
  };
};

wb.onTime((time, { chapter, chapterTime }) => {
  const { x, y, rx, ry, rz } = pose(time);
  die.position.set(x, y, 0);
  die.rotation.set(rx, ry, rz);
  result.style.opacity =
    chapter?.key === "result" ? String(clamp(chapterTime / 300)) : "0";
  renderer.render(scene, camera);
});
