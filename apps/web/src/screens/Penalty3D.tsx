import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { drillSounds, once } from "../lib/sound.js";
import { BALL, GOAL_M, type Kick, type PenaltySetup, type Press, penalties, sway, toScreen } from "../../../relay/src/penalty.js";

/**
 * The penalty game in 3D. Same rules, same trace as the 2D game: the outcome
 * comes from penalty.ts, which the relay replays to sign the score. The 3D
 * scene is only a view: a press on the ball is recorded at the ball's logical
 * spot, and the release at the logical point of the goal you aimed at.
 */

const INK = 0x1b2340;
const PAPER = 0xf3ead7;
const RED = 0xc8202f;
const YELLOW = 0xf2b705;
const BLUE = 0x2f5da8;
const HW = GOAL_M.halfWidth;
const GH = GOAL_M.height;
const SPOT = 11;
const BALL_R = 0.11;
const LOOK_Y = 0.6;

const VERDICT: Record<string, string> = {
  goal: "GOAL!",
  saved: "SAVED!",
  wide: "WIDE!",
  over: "OVER THE BAR!",
  post: "OFF THE POST!",
  none: "TOO LATE",
};

/** A canvas texture: the grass with its stripes and lines, seen from above (x -40..40 m, z -10..50 m). */
function pitchTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 1536;
  const g = c.getContext("2d")!;
  const sx = c.width / 80;
  const sz = c.height / 60;
  const X = (x: number) => (x + 40) * sx;
  const Z = (z: number) => (z + 10) * sz;
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? "#4AB226" : "#5BC72E";
    g.fillRect(0, i * (c.height / 16), c.width, c.height / 16 + 1);
  }
  g.strokeStyle = "rgba(255,255,255,.92)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, Z(0));
  g.lineTo(c.width, Z(0)); // goal line
  g.strokeRect(X(-20.16), Z(0), 40.32 * sx, 16.5 * sz); // penalty box
  g.strokeRect(X(-9.16), Z(0), 18.32 * sx, 5.5 * sz); // six-yard box
  g.stroke();
  g.beginPath();
  g.ellipse(X(0), Z(SPOT), 9.15 * sx, 9.15 * sz, 0, 0.93, Math.PI - 0.93); // the D
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A net: white strings on a transparent square, repeated. */
function netTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,.75)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, 30, 30);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The ball's skin: white with dark patches, wrapped on a sphere. */
function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fffaf0";
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#1B2340";
  const pent = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let k = 0; k < 5; k++) g.lineTo(x + r * Math.sin((k * 2 * Math.PI) / 5), y - r * Math.cos((k * 2 * Math.PI) / 5));
    g.closePath();
    g.fill();
  };
  for (let i = 0; i < 6; i++) {
    pent(i * 43 + 10, 30, 13);
    pent(i * 43 + 31, 92, 13);
  }
  pent(128, 4, 30);
  pent(128, 124, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The boards behind the goal. */
function boardsTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 64;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#251A57" : "#C8202F";
    g.fillRect(i * 256, 0, 256, 64);
    g.fillStyle = i % 2 ? "#F2B705" : "#F3EAD7";
    g.font = "700 36px 'Pixelify Sans', system-ui";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(i % 2 ? "$G" : "NEAR POST", i * 256 + 128, 34);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The stand behind the goal (art/penalty/stand.webp): fans, tifo star and floodlights. */
function stand(): THREE.Mesh {
  const map = new THREE.TextureLoader().load("/art/penalty/stand.webp");
  map.colorSpace = THREE.SRGBColorSpace;
  const w = 36;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * 698) / 2048), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false }));
  mesh.position.set(0, (w * 698) / 2048 / 2 - 0.4, -10);
  mesh.userData.y = mesh.position.y;
  return mesh;
}

/** Repaints the key-blue kit (hue 205-260) of a sprite sheet in the club's colour, keeping the shading. */
function recolor(img: HTMLImageElement, to: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const t = new THREE.Color(to);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3]! < 8) continue;
    const r = p[i]! / 255;
    const gg = p[i + 1]! / 255;
    const b = p[i + 2]! / 255;
    const mx = Math.max(r, gg, b);
    const mn = Math.min(r, gg, b);
    if (mx !== b || mx - mn < 0.35 * mx) continue;
    const h = 60 * ((r - gg) / (mx - mn) + 4);
    if (h < 205 || h > 260) continue;
    const k = Math.min(1.25, mx / 0.9); // the kit's light and shade
    p[i] = Math.min(255, t.r * 255 * k);
    p[i + 1] = Math.min(255, t.g * 255 * k);
    p[i + 2] = Math.min(255, t.b * 255 * k);
  }
  g.putImageData(d, 0, 0);
  return c;
}

/**
 * A footballer drawn from a strip of six frames (art/penalty/*.webp): a
 * billboard, feet at the root, one frame at a time, mirrored on demand,
 * with a soft shadow on the grass.
 */
function spriteFigure(url: string, cellH: number, aspect: number, shirt?: string) {
  const root = new THREE.Group();
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.repeat.set(1 / 6, 1);
  const img = new Image();
  img.onload = () => {
    tex.image = shirt ? recolor(img, shirt) : img;
    tex.needsUpdate = true;
  };
  img.src = url;
  const w = cellH * aspect;
  const geo = new THREE.PlaneGeometry(w, cellH);
  geo.translate(0, cellH / 2, 0);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4 });
  root.add(new THREE.Mesh(geo, mat));
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  /** Frame 0..5, mirrored or not, feet at (x, y, z); `long` stretches the shadow for a dive. */
  const show = (frame: number, flip: boolean, x: number, y: number, z: number, long = 1) => {
    tex.offset.x = flip ? (frame + 1) / 6 : frame / 6;
    tex.repeat.x = flip ? -1 / 6 : 1 / 6;
    root.position.set(x, y, z);
    shadow.position.set(x, 0.01, z);
    shadow.scale.set(long, 0.42, 1);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * Math.max(0.35, 1 - y / 1.2);
  };
  return { root, shadow, show, dispose: () => tex.dispose() };
}

/** Keeper frames (keeper.webp). The dives go to the left of the picture: mirrored for the other side. */
const K = { ready: 0, low: 1, high: 2, hold: 3, beaten: 4, joy: 5 };
/** Shooter frames (shooter.webp), seen from behind. */
const S = { wait: 0, run: 1, windup: 2, strike: 3, joy: 4, despair: 5 };

export function PenaltyGame3D({ setup, onDone, shirt }: { setup: PenaltySetup; onDone: (trace: Press[]) => void; /** Your club's colour for the shooter's shirt (default: blue). */ shirt?: string }) {
  const host = useRef<HTMLDivElement>(null);
  /** The power meter (ten square cells), lit straight from the pointer handlers: no re-render per move. */
  const meter = useRef<HTMLDivElement>(null);
  const trace = useRef<Press[]>([]);
  const [score, setScore] = useState<(boolean | null)[]>(Array(setup.kicks.length).fill(null));
  const [verdict, setVerdict] = useState<{ text: string; goal: boolean; key: number } | null>(null);
  const [hint, setHint] = useState("Press on the ball, drag to your target, release");
  // The kicks' sounds while the drill is on screen.
  useEffect(() => drillSounds(), []);

  useEffect(() => {
    const el = host.current!;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1240);
    scene.fog = new THREE.Fog(0x1a1240, 30, 70);
    const camera = new THREE.PerspectiveCamera(30, 5 / 3, 0.1, 200);
    const camHome = new THREE.Vector3(0.3, 2.0, SPOT + 7.5);
    camera.position.copy(camHome);
    camera.lookAt(0, LOOK_Y, 0);

    scene.add(new THREE.HemisphereLight(0xd9d2f0, 0x4ab226, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 18, 22);
    sun.target.position.set(0, 0, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 12, bottom: -6, near: 1, far: 60 });
    scene.add(sun, sun.target);

    const grassTex = pitchTexture();
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshLambertMaterial({ map: grassTex }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(0, 0, 20);
    pitch.receiveShadow = true;
    scene.add(pitch);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, 0.005, SPOT);
    scene.add(spot);

    // The goal: posts, bar and a net that bulges where the ball goes in.
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const post = (x: number) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, GH + 0.06, 12), white);
      p.position.set(x, GH / 2, 0);
      p.castShadow = true;
      return p;
    };
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2 * HW + 0.12, 12), white);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GH, 0);
    scene.add(post(-HW), post(HW), bar);
    const mesh = netTexture();
    const net = (w: number, h: number, sw: number, sh: number) => {
      const map = mesh.clone();
      map.repeat.set(w / 0.16, h / 0.16);
      map.needsUpdate = true;
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h, sw, sh), new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    };
    const back = net(2 * HW, GH, 44, 16);
    back.position.set(0, GH / 2, -1.9);
    const roof = net(2 * HW, 1.9, 4, 4);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(0, GH, -0.95);
    const sideL = net(1.9, GH, 4, 4);
    sideL.rotation.y = Math.PI / 2;
    sideL.position.set(-HW, GH / 2, -0.95);
    const sideR = net(1.9, GH, 4, 4);
    sideR.rotation.y = Math.PI / 2;
    sideR.position.set(HW, GH / 2, -0.95);
    scene.add(back, roof, sideL, sideR);
    const backRest = (back.geometry.attributes.position!.array as Float32Array).slice();

    const boards = new THREE.Mesh(new THREE.PlaneGeometry(46, 0.9), new THREE.MeshBasicMaterial({ map: boardsTexture() }));
    boards.position.set(0, 0.45, -5);
    scene.add(boards);
    const fans = stand();
    scene.add(fans);

    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 18), new THREE.MeshLambertMaterial({ map: ballTexture() }));
    ballMesh.castShadow = true;
    scene.add(ballMesh);
    // The keeper, and you seen from behind.
    const kp = spriteFigure("/art/penalty/keeper.webp", 2.04, 384 / 360);
    scene.add(kp.root, kp.shadow);
    const me = spriteFigure("/art/penalty/shooter.webp", 1.84, 301 / 400, shirt);
    scene.add(me.root, me.shadow);

    // Aiming: a ring on the goal plane and a dashed line from the ball.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.23, 32), new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.95, depthTest: false }));
    ring.renderOrder = 10;
    ring.visible = false;
    scene.add(ring);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const aimLine = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.25, depthTest: false }));
    aimLine.renderOrder = 10;
    aimLine.visible = false;
    scene.add(aimLine);

    const resize = () => {
      const w = el.clientWidth;
      const h = Math.round(w < 600 ? (w * 4) / 5 : (w * 3) / 5); // taller on a phone: a bigger goal
      renderer.setSize(w, h, false);
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // ---- Input: presses on the ball, releases on the goal.
    const start = performance.now();
    const now = () => Math.round(performance.now() - start);
    const ray = new THREE.Raycaster();
    const goalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let aiming = false;
    let aimFrom = 0;
    // The same rule the relay applies on release: swipe speed in screen units per ms, 0.25 to 1.85.
    const showPower = (p: number | null) => {
      const cells = meter.current?.children;
      if (!cells) return;
      meter.current!.classList.toggle("on", p !== null);
      for (let i = 0; i < cells.length; i++) cells[i]!.className = p !== null && i < Math.round(p * cells.length) ? (i >= 8 ? "hot" : "lit") : "";
    };
    let aimAt: { x: number; y: number } | null = null;
    const ndc = (e: PointerEvent) => {
      const b = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    };
    /** The point of the goal plane under the pointer, in metres, within what penalty.ts can record. */
    const goalPoint = (e: PointerEvent) => {
      ray.setFromCamera(ndc(e), camera);
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(goalPlane, p)) return null;
      return { x: Math.max(-9, Math.min(9, p.x)), y: Math.max(0, Math.min(5, p.y)) };
    };
    const logical = (e: PointerEvent) => {
      // Anywhere but the ball, in the same 1000 x 600 frame the 2D game uses.
      const b = renderer.domElement.getBoundingClientRect();
      const x = Math.round(Math.min(1000, Math.max(0, ((e.clientX - b.left) / b.width) * 1000)));
      const y = Math.round(Math.min(600, Math.max(0, ((e.clientY - b.top) / b.height) * 600)));
      return Math.hypot(x - BALL.x, y - BALL.y) <= BALL.grab ? { x: 0, y: 0 } : { x, y };
    };
    const onBall = (e: PointerEvent) => {
      const p = ballMesh.position.clone().project(camera);
      const b = renderer.domElement.getBoundingClientRect();
      const bx = ((p.x + 1) / 2) * b.width;
      const by = ((1 - p.y) / 2) * b.height;
      return Math.hypot(e.clientX - b.left - bx, e.clientY - b.top - by) < Math.max(48, b.width * 0.07);
    };
    const down = (e: PointerEvent) => {
      renderer.domElement.setPointerCapture(e.pointerId);
      if (onBall(e)) {
        aiming = true;
        aimFrom = now();
        showPower(0);
        trace.current.push({ t: aimFrom, x: BALL.x, y: BALL.y });
      } else trace.current.push({ t: now(), ...logical(e) });
    };
    const move = (e: PointerEvent) => {
      if (!aiming) return;
      aimAt = goalPoint(e);
      if (aimAt) {
        const sp = toScreen(aimAt.x, aimAt.y);
        const swipe = Math.hypot(sp.x - BALL.x, sp.y - BALL.y) / Math.max(50, now() - aimFrom);
        showPower(Math.min(1, Math.max(0, (swipe - 0.25) / 1.6)));
      }
    };
    const up = (e: PointerEvent) => {
      const g = aiming ? goalPoint(e) : null;
      if (g) {
        const s = toScreen(g.x, g.y);
        trace.current.push({ t: now(), x: Math.round(Math.min(1000, Math.max(0, s.x))), y: Math.round(Math.min(600, Math.max(0, s.y))), up: true });
      } else trace.current.push({ t: now(), ...logical(e), up: true });
      aiming = false;
      aimAt = null;
      setTimeout(() => showPower(null), 900);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);

    // ---- The loop: the kicks from the trace, the scene from the kicks.
    let raf = 0;
    let finished = false;
    let shown = -1;
    const frame = () => {
      const t = performance.now() - start;
      const kicks: Kick[] = penalties(setup, trace.current);
      const i = Math.max(0, kicks.findIndex((k) => t < k.end));
      const k = kicks[i] ?? kicks[kicks.length - 1]!;
      const shot = k.shot && t >= k.shot.up ? k.shot : null;
      const landed = shot ? Math.min(1, (t - shot.up) / shot.flight) : 0;
      const after = shot && landed >= 1 ? t - shot.up - shot.flight : -1;
      const scored = !!shot && after >= 0 && shot.result === "goal";
      if (shot) once(`pen:${i}:kick`, "kick", (shot.speed - 13) / 17);
      if (shot && after >= 0) {
        const end = shot.result === "goal" ? "net" : shot.result === "saved" ? "save" : shot.result === "post" ? "post" : null;
        if (end) once(`pen:${i}:end`, end);
      }

      // Keeper: sways on his line, then dives towards where he reads it.
      const p = setup.kicks[Math.min(i, setup.kicks.length - 1)]!;
      let kx = sway(p.phase, Math.max(0, (shot ? shot.up : t) - k.start));
      let lift = 0;
      let hop = Math.abs(Math.sin(t / 190)) * 0.05; // light on his toes
      let kf = K.ready;
      let kFlip = Math.sin(t / 600) > 0;
      let long = 1;
      if (shot) {
        hop = 0;
        const d = Math.min(1, Math.max(0, (t - shot.keeper.reactAt) / Math.max(1, shot.keeper.reachAt - shot.keeper.reactAt)));
        const e = 1 - (1 - d) * (1 - d);
        kx = shot.keeper.from + (shot.keeper.to - shot.keeper.from) * e;
        const side = Math.sign(shot.keeper.to - shot.keeper.from || 0.01);
        const far = Math.min(1, Math.abs(shot.keeper.to - shot.keeper.from) / 1.2);
        const high = shot.target.y > 1.1;
        kFlip = side > 0;
        if (t >= shot.keeper.reactAt) {
          if (far > 0.3) {
            kf = high ? K.high : K.low;
            lift = high ? Math.min(shot.target.y - 1.1, 0.8) * e : 0.15 * Math.sin(e * Math.PI);
            long = 2.2;
          } else lift = high ? Math.min(shot.target.y - 1.2, 0.7) * e : 0;
        }
        if (after > 0) {
          lift = Math.max(0, lift - after / 500);
          if (shot.result === "goal" && after > 250) {
            kf = K.beaten; // flat on the grass
            long = 2.4;
          } else if (shot.result === "saved" && after > 450) {
            kf = far > 0.3 ? K.joy : K.hold;
            long = 1;
            hop = kf === K.joy ? Math.abs(Math.sin(after / 120)) * 0.12 : 0;
          } else if (shot.result !== "goal" && after > 450) {
            kf = K.joy;
            long = 1;
            hop = Math.abs(Math.sin(after / 120)) * 0.12;
          }
        }
      }
      kp.show(kf, kFlip, kx, lift + hop, 0.5, long);

      // You: a jog to your mark, the wind-up while you aim, the strike, then joy or hands on the head.
      const mark = { x: -1.45, z: SPOT + 1.35 };
      const hit = { x: -0.34, z: SPOT + 0.45 };
      const since = t - k.start;
      let sf = S.wait;
      let sFlip = false;
      let sx = mark.x;
      let sz = mark.z;
      let sy = 0;
      if (!shot) {
        if (aiming) sf = S.windup;
        else if (since < 900) {
          const f = since / 900;
          sx = mark.x - 0.6 * (1 - f);
          sz = mark.z + 2.6 * (1 - f) * (1 - f);
          sf = S.run;
          sFlip = Math.floor(since / 120) % 2 === 1; // the other leg
          sy = Math.abs(Math.sin(since / 76)) * 0.06;
        }
      } else {
        const s = t - shot.up;
        const f = Math.min(1, s / 180);
        sx = mark.x + (hit.x - mark.x) * f;
        sz = mark.z + (hit.z - mark.z) * f;
        sf = s < 320 ? S.strike : S.wait;
        if (after > 150) {
          if (shot.result === "goal") {
            sf = S.joy;
            sy = Math.abs(Math.sin(after / 130)) * 0.2;
          } else sf = S.despair;
        }
      }
      me.show(sf, sFlip, sx, sy, sz);

      // Ball: on the spot, in flight, then where the result sends it.
      if (!shot) {
        ballMesh.position.set(0, BALL_R, SPOT);
      } else {
        const to = new THREE.Vector3(shot.target.x, Math.max(BALL_R, shot.target.y), 0);
        if (landed < 1) {
          ballMesh.position.set(to.x * landed, BALL_R + (to.y - BALL_R) * landed + Math.sin(landed * Math.PI) * 0.25, SPOT * (1 - landed));
        } else {
          const a = Math.min(1, after / 800);
          if (shot.result === "goal") ballMesh.position.set(to.x * (1 + 0.04 * a), Math.max(BALL_R, to.y - 1.2 * a * a), -1.7 * Math.min(1, a * 2.5));
          else if (shot.result === "saved") ballMesh.position.set(to.x + Math.sign(to.x || 1) * 2.4 * a, Math.max(BALL_R, to.y + 0.8 * Math.sin(a * Math.PI) - 0.6 * a), 0.6 + 1.5 * a);
          else if (shot.result === "post") ballMesh.position.set(to.x - Math.sign(to.x || 1) * 1.5 * a, Math.max(BALL_R, to.y - 1.4 * a), 2.6 * a);
          else ballMesh.position.set(to.x * (1 + 0.5 * a), to.y + 0.6 * a, -5 * a);
        }
        ballMesh.rotation.x -= 0.35;
        ballMesh.rotation.y += 0.12;
      }

      // The net bulges where the ball goes in.
      const pos = back.geometry.attributes.position!;
      const arr = pos.array as Float32Array;
      const push = scored ? Math.max(0, 1 - after / 900) * 0.7 : 0;
      for (let v = 0; v < arr.length; v += 3) {
        const dx = arr[v]! - (shot?.target.x ?? 0);
        const dy = arr[v + 1]! + GH / 2 - (shot?.target.y ?? 0);
        arr[v + 2] = backRest[v + 2]! - push * Math.exp(-(dx * dx + dy * dy) / 0.5);
      }
      pos.needsUpdate = true;

      // The stand shakes after a goal.
      fans.position.y = fans.userData.y + (scored && after < 2600 ? Math.abs(Math.sin(after / 95)) * 0.12 * (1 - after / 2600) : 0);

      // Aim marker.
      const showAim = aiming && aimAt && !k.shot;
      ring.visible = !!showAim;
      aimLine.visible = !!showAim;
      if (showAim && aimAt) {
        ring.position.set(aimAt.x, aimAt.y, 0.02);
        lineGeo.setFromPoints([ballMesh.position.clone(), new THREE.Vector3(aimAt.x, aimAt.y, 0)]);
        aimLine.computeLineDistances();
      }

      // Camera: a small push in during the shot, a shake on a goal.
      const zoom = shot ? Math.min(1, (t - shot.up) / 600) * 1.2 : 0;
      camera.position.set(camHome.x, camHome.y, camHome.z - zoom);
      if (scored && after < 350) camera.position.x += Math.sin(after / 18) * 0.04 * (1 - after / 350);
      camera.lookAt(0, LOOK_Y, 0);
      renderer.render(scene, camera);

      // The score and the words on screen.
      const done = kicks.map((kk) => (kk.shot && t >= kk.shot.up + kk.shot.flight ? kk.shot.result === "goal" : t >= kk.end ? false : null));
      setScore((prev) => (prev.join() === done.join() ? prev : done));
      if (shot && after >= 0 && shown !== i) {
        shown = i;
        setVerdict({ text: VERDICT[shot.result]!, goal: shot.result === "goal", key: i });
      }
      if (!shot && t < k.end) {
        setVerdict(null);
        setHint(i === 0 && t - k.start < 4000 ? "Press on the ball, drag to your target, release" : `Penalty ${i + 1} of ${kicks.length}`);
      } else setHint("");
      const last = kicks[kicks.length - 1]!;
      if (!finished && t >= last.end) {
        finished = true;
        onDone(trace.current);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      kp.dispose();
      me.dispose();
      (fans.material as THREE.MeshBasicMaterial).map?.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = score.filter((s) => s).length;
  return (
    <div className="drill-wrap pen3d">
      <div className="drill-head">
        <span>
          Penalties · {n} goal{n === 1 ? "" : "s"}
        </span>
        <span className="pen-dots" aria-label="Kicks">
          {score.map((s, i) => (
            <i key={i} className={s === null ? "" : s ? "in" : "out"} />
          ))}
        </span>
      </div>
      <div className="pen3d-stage">
        <div ref={host} role="application" aria-label="Penalty: press on the ball, drag to where you aim in the goal, release. A quick swipe shoots harder." />
        <div ref={meter} className="pen-power" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} />
          ))}
          <span>POWER</span>
        </div>
        {hint && <div className="pen3d-hint">{hint}</div>}
        {verdict && (
          <div key={verdict.key} className={`pen3d-verdict${verdict.goal ? " goal" : ""}`}>
            {verdict.text}
          </div>
        )}
      </div>
      <p className="note pen-help">Press on the ball, drag to where you aim, release. A firm swipe beats the keeper; a flick drifts, a slow shot gives him time.</p>
    </div>
  );
}

export const PALETTE = { INK, PAPER, RED, YELLOW, BLUE };
