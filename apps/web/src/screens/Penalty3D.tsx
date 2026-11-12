import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
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
const SKIN = 0xc68b5e;
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

/** The fans behind the goal: one box each, painting a tifo (a yellow star on blue, a red and white scarf). */
function crowd(): { mesh: THREE.InstancedMesh; base: THREE.Matrix4[]; phase: number[] } {
  const cols = 64;
  const rows = 14;
  const geo = new THREE.BoxGeometry(0.62, 0.62, 0.3);
  const mat = new THREE.MeshLambertMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, cols * rows);
  const base: THREE.Matrix4[] = [];
  const phase: number[] = [];
  const color = new THREE.Color();
  let n = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i - cols / 2 + 0.5) * 0.72;
      const y = 1.2 + j * 0.62;
      const z = -9 - j * 0.75;
      const m = new THREE.Matrix4().makeTranslation(x, y, z);
      mesh.setMatrixAt(n, m);
      base.push(m);
      phase.push(Math.random() * Math.PI * 2);
      const cx = i - cols / 2 + 0.5;
      const cy = j - rows / 2 + 0.5;
      const a = Math.atan2(cx, cy);
      const d = Math.hypot(cx * 0.55, cy);
      const k = (((a / (2 * Math.PI)) * 5 + 5) % 1);
      const star = d < 2.2 + 3.2 * Math.abs(k - 0.5) * 2;
      const scarf = j === 0 || j === rows - 1;
      color.setHex(scarf ? ((i + j) % 2 ? RED : 0xffffff) : star ? YELLOW : BLUE);
      mesh.setColorAt(n, color);
      n++;
    }
  }
  return { mesh, base, phase };
}

/** The keeper: a simple figure in yellow, built so he can sway, crouch and dive. */
function keeperFigure() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });
  const capsule = (r: number, l: number, c: number) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), mat(c));
  const torso = capsule(0.24, 0.45, YELLOW);
  torso.position.y = 1.22;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), mat(SKIN));
  head.position.y = 1.72;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a1a10));
  hair.position.y = 1.74;
  const shorts = capsule(0.22, 0.12, INK);
  shorts.position.y = 0.88;
  const legL = capsule(0.085, 0.62, INK);
  const legR = capsule(0.085, 0.62, INK);
  legL.position.set(-0.12, 0.42, 0);
  legR.position.set(0.12, 0.42, 0);
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [arm, s] of [
    [armL, -1],
    [armR, 1],
  ] as const) {
    const a = capsule(0.07, 0.55, YELLOW);
    a.position.y = -0.3;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), mat(0xffffff));
    glove.position.y = -0.64;
    arm.add(a, glove);
    arm.position.set(s * 0.3, 1.48, 0);
  }
  body.add(torso, head, hair, shorts, legL, legR, armL, armR);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { root, body, armL, armR };
}

export function PenaltyGame3D({ setup, onDone }: { setup: PenaltySetup; onDone: (trace: Press[]) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const trace = useRef<Press[]>([]);
  const [score, setScore] = useState<(boolean | null)[]>(Array(setup.kicks.length).fill(null));
  const [verdict, setVerdict] = useState<{ text: string; goal: boolean; key: number } | null>(null);
  const [hint, setHint] = useState("Press on the ball, drag to your target, release");

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
    const fans = crowd();
    scene.add(fans.mesh);
    const roofStand = new THREE.Mesh(new THREE.BoxGeometry(60, 0.4, 14), new THREE.MeshLambertMaterial({ color: 0x121933 }));
    roofStand.position.set(0, 11.2, -14);
    scene.add(roofStand);

    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 18), new THREE.MeshLambertMaterial({ map: ballTexture() }));
    ballMesh.castShadow = true;
    scene.add(ballMesh);
    const kp = keeperFigure();
    scene.add(kp.root);

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
        trace.current.push({ t: now(), x: BALL.x, y: BALL.y });
      } else trace.current.push({ t: now(), ...logical(e) });
    };
    const move = (e: PointerEvent) => {
      if (aiming) aimAt = goalPoint(e);
    };
    const up = (e: PointerEvent) => {
      const g = aiming ? goalPoint(e) : null;
      if (g) {
        const s = toScreen(g.x, g.y);
        trace.current.push({ t: now(), x: Math.round(Math.min(1000, Math.max(0, s.x))), y: Math.round(Math.min(600, Math.max(0, s.y))), up: true });
      } else trace.current.push({ t: now(), ...logical(e), up: true });
      aiming = false;
      aimAt = null;
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

      // Keeper: sways on his line, then dives towards where he reads it.
      const p = setup.kicks[Math.min(i, setup.kicks.length - 1)]!;
      let kx = sway(p.phase, Math.max(0, (shot ? shot.up : t) - k.start));
      let roll = 0;
      let lift = 0;
      let reach = 0.25 + 0.08 * Math.sin(t / 180);
      if (shot) {
        const d = Math.min(1, Math.max(0, (t - shot.keeper.reactAt) / Math.max(1, shot.keeper.reachAt - shot.keeper.reactAt)));
        const e = 1 - (1 - d) * (1 - d);
        kx = shot.keeper.from + (shot.keeper.to - shot.keeper.from) * e;
        const side = Math.sign(shot.keeper.to - shot.keeper.from || 0.01);
        const far = Math.min(1, Math.abs(shot.keeper.to - shot.keeper.from) / 1.2);
        roll = -side * far * e * 1.25;
        lift = Math.min(shot.target.y, 1.4) * e * (far > 0.3 ? 0.55 : 0.25);
        reach = 0.25 + 2.6 * e;
        if (after > 400) lift = Math.max(0, lift - (after - 400) / 600);
      }
      kp.root.position.set(kx, lift, 0.5);
      kp.body.rotation.z = roll;
      kp.armL.rotation.z = -reach;
      kp.armR.rotation.z = reach;

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

      // Fans: a sway, and they jump after a goal.
      const m = new THREE.Matrix4();
      for (let n = 0; n < fans.base.length; n++) {
        const jump = scored && after < 2600 ? Math.abs(Math.sin(after / 110 + fans.phase[n]!)) * 0.28 : Math.sin(t / 700 + fans.phase[n]!) * 0.02;
        m.copy(fans.base[n]!).multiply(new THREE.Matrix4().makeTranslation(0, jump, 0));
        fans.mesh.setMatrixAt(n, m);
      }
      fans.mesh.instanceMatrix.needsUpdate = true;

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
