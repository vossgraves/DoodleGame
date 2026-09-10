import * as THREE from "three";

export interface Collider {
  minx: number;
  miny: number;
  minz: number;
  maxx: number;
  maxy: number;
  maxz: number;
  noShoot?: boolean;
  q?: number;
}

const EPS = 0.002;
const CELL = 6;

export const PEN_MAX_THICK = 0.9;
export const PEN_DAMAGE = 0.45;

export class World {
  boxes: Collider[] = [];
  bounds = { minX: -42, maxX: 42, minZ: -42, maxZ: 42 };

  private grid = new Map<number, Collider[]>();
  private gridDirty = true;
  private stamp = 0;
  private _los = new THREE.Vector3();
  private _cands: Collider[] = [];
  private _hitBox: Collider | null = null;

  clear() {
    this.boxes.length = 0;
    this.gridDirty = true;
  }

  addBox(cx: number, y: number, cz: number, w: number, h: number, d: number, flags: { noShoot?: boolean } = {}) {
    this.boxes.push({
      minx: cx - w / 2,
      maxx: cx + w / 2,
      miny: y,
      maxy: y + h,
      minz: cz - d / 2,
      maxz: cz + d / 2,
      noShoot: flags.noShoot,
    });
    this.gridDirty = true;
  }

  private ensureGrid() {
    if (!this.gridDirty) return;
    this.grid.clear();
    for (const b of this.boxes) {
      const x0 = Math.floor(b.minx / CELL), x1 = Math.floor(b.maxx / CELL);
      const z0 = Math.floor(b.minz / CELL), z1 = Math.floor(b.maxz / CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const k = gx + gz * 8192;
          let cell = this.grid.get(k);
          if (!cell) this.grid.set(k, (cell = []));
          cell.push(b);
        }
      }
    }
    this.gridDirty = false;
  }

  private eachOverlapped(minx: number, minz: number, maxx: number, maxz: number, fn: (b: Collider) => void) {
    this.ensureGrid();
    const st = ++this.stamp;
    const x0 = Math.floor(minx / CELL), x1 = Math.floor(maxx / CELL);
    const z0 = Math.floor(minz / CELL), z1 = Math.floor(maxz / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const cell = this.grid.get(gx + gz * 8192);
        if (!cell) continue;
        for (const b of cell) {
          if (b.q === st) continue;
          b.q = st;
          fn(b);
        }
      }
    }
  }

  private overlaps(c: Collider, minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number) {
    return minx < c.maxx && maxx > c.minx && miny < c.maxy && maxy > c.miny && minz < c.maxz && maxz > c.minz;
  }

  moveAABB(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    halfW: number,
    height: number,
    dt: number,
    gravity: number,
  ): { onGround: boolean; hitWall: boolean; stepped: boolean; wallNormal: THREE.Vector3 | null } {
    vel.y -= gravity * dt;
    if (vel.y < -36) vel.y = -36;

    let onGround = false;
    let hitWall = false;
    let stepped = false;
    let wallNormal: THREE.Vector3 | null = null;

    const cands = this._cands;
    cands.length = 0;
    this.eachOverlapped(
      Math.min(pos.x, pos.x + vel.x * dt) - halfW - EPS,
      Math.min(pos.z, pos.z + vel.z * dt) - halfW - EPS,
      Math.max(pos.x, pos.x + vel.x * dt) + halfW + EPS,
      Math.max(pos.z, pos.z + vel.z * dt) + halfW + EPS,
      (b) => {
        cands.push(b);
      },
    );

    const prevY = pos.y;
    pos.y += vel.y * dt;
    {
      const minx = pos.x - halfW,
        maxx = pos.x + halfW;
      const miny = pos.y,
        maxy = pos.y + height;
      const minz = pos.z - halfW,
        maxz = pos.z + halfW;
      for (const b of cands) {
        if (!this.overlaps(b, minx, miny, minz, maxx, maxy, maxz)) continue;
        const wasAbove = prevY + EPS >= b.maxy;
        if (vel.y <= 0 && (wasAbove || pos.y + height * 0.5 > b.maxy)) {
          pos.y = b.maxy + EPS;
          vel.y = 0;
          onGround = true;
        } else if (vel.y > 0) {
          pos.y = b.miny - height - EPS;
          vel.y = 0;
        }
      }
    }

    const tryAxis = (axis: "x" | "z", delta: number) => {
      if (delta === 0) return;
      pos[axis] += delta;
      const minx = pos.x - halfW,
        maxx = pos.x + halfW;
      const miny = pos.y + 0.08,
        maxy = pos.y + height;
      const minz = pos.z - halfW,
        maxz = pos.z + halfW;
      for (const b of cands) {
        if (!this.overlaps(b, minx, miny, minz, maxx, maxy, maxz)) continue;
        const stepH = b.maxy - pos.y;
        if (onGround && stepH > 0 && stepH <= 0.45 && b.maxy < pos.y + height * 0.55) {
          const oldY = pos.y;
          pos.y = b.maxy + EPS;
          const ok = !this.blocked(pos, halfW, height);
          if (ok) {
            stepped = true;
            onGround = true;
            continue;
          }
          pos.y = oldY;
        }
        if (axis === "x") {
          if (delta > 0) pos.x = b.minx - halfW - EPS;
          else pos.x = b.maxx + halfW + EPS;
          wallNormal = new THREE.Vector3(delta > 0 ? -1 : 1, 0, 0);
        } else {
          if (delta > 0) pos.z = b.minz - halfW - EPS;
          else pos.z = b.maxz + halfW + EPS;
          wallNormal = new THREE.Vector3(0, 0, delta > 0 ? -1 : 1);
        }
        vel[axis] = 0;
        hitWall = true;
      }
    };

    tryAxis("x", vel.x * dt);
    tryAxis("z", vel.z * dt);

    pos.x = Math.max(this.bounds.minX + halfW, Math.min(this.bounds.maxX - halfW, pos.x));
    pos.z = Math.max(this.bounds.minZ + halfW, Math.min(this.bounds.maxZ - halfW, pos.z));
    if (pos.y < -4) {
      pos.y = this.groundY(pos.x, pos.z);
      vel.set(0, 0, 0);
      onGround = true;
    }
    return { onGround, hitWall, stepped, wallNormal };
  }

  blocked(pos: THREE.Vector3, halfW: number, height: number) {
    const minx = pos.x - halfW,
      maxx = pos.x + halfW;
    const miny = pos.y + 0.1,
      maxy = pos.y + height;
    const minz = pos.z - halfW,
      maxz = pos.z + halfW;
    let blocked = false;
    this.eachOverlapped(minx, minz, maxx, maxz, (b) => {
      if (this.overlaps(b, minx, miny, minz, maxx, maxy, maxz)) blocked = true;
    });
    return blocked;
  }

  private rayHitT(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, skipNoShoot: boolean) {
    this.ensureGrid();
    const st = ++this.stamp;
    let best = maxDist;
    let hit: Collider | null = null;

    let cx = Math.floor(o.x / CELL),
      cz = Math.floor(o.z / CELL);
    const stepX = d.x > 0 ? 1 : -1,
      stepZ = d.z > 0 ? 1 : -1;
    const tDX = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity;
    const tDZ = Math.abs(d.z) > 1e-9 ? CELL / Math.abs(d.z) : Infinity;
    let tMaxX = Math.abs(d.x) > 1e-9 ? ((cx + (stepX > 0 ? 1 : 0)) * CELL - o.x) / d.x : Infinity;
    let tMaxZ = Math.abs(d.z) > 1e-9 ? ((cz + (stepZ > 0 ? 1 : 0)) * CELL - o.z) / d.z : Infinity;

    for (;;) {
      const cell = this.grid.get(cx + cz * 8192);
      if (cell) {
        for (const b of cell) {
          if (b.q === st) continue;
          b.q = st;
          if (skipNoShoot && b.noShoot) continue;
          const t = rayAabb(o, d, b, best);
          if (t !== null && t < best && t >= 0) {
            best = t;
            hit = b;
          }
        }
      }
      let t: number;
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDX;
        cx += stepX;
      } else {
        t = tMaxZ;
        tMaxZ += tDZ;
        cz += stepZ;
      }
      if (t > best) break;
    }
    this._hitBox = hit;
    return hit ? best : -1;
  }

  raycast(
    o: THREE.Vector3,
    d: THREE.Vector3,
    maxDist: number,
    skipNoShoot = false,
  ): { dist: number; point: THREE.Vector3; nx: number; ny: number; nz: number; box: Collider } | null {
    const best = this.rayHitT(o, d, maxDist, skipNoShoot);
    if (best < 0) return null;
    const hit = this._hitBox!;
    const px = o.x + d.x * best,
      py = o.y + d.y * best,
      pz = o.z + d.z * best;
    let nx = 0,
      ny = 0,
      nz = 0;
    const e = 0.02;
    if (Math.abs(px - hit.minx) < e) nx = -1;
    else if (Math.abs(px - hit.maxx) < e) nx = 1;
    else if (Math.abs(py - hit.miny) < e) ny = -1;
    else if (Math.abs(py - hit.maxy) < e) ny = 1;
    else if (Math.abs(pz - hit.minz) < e) nz = -1;
    else nz = 1;
    return {
      dist: best,
      point: new THREE.Vector3(px, py, pz),
      nx,
      ny,
      nz,
      box: hit,
    };
  }

  thickness(point: THREE.Vector3, d: THREE.Vector3, b: Collider): number {
    const inside = new THREE.Vector3(point.x + d.x * EPS, point.y + d.y * EPS, point.z + d.z * EPS);
    let far = 0;
    for (const axis of ["x", "y", "z"] as const) {
      const dir = d[axis];
      if (Math.abs(dir) < 1e-8) continue;
      const min = axis === "x" ? b.minx : axis === "y" ? b.miny : b.minz;
      const max = axis === "x" ? b.maxx : axis === "y" ? b.maxy : b.maxz;
      const t = ((dir > 0 ? max : min) - inside[axis]) / dir;
      if (t > 0 && (far === 0 || t < far)) far = t;
    }
    return far;
  }

  penTrace(
    o: THREE.Vector3,
    d: THREE.Vector3,
    maxDist: number,
  ): { dist: number; point: THREE.Vector3; penAt: number | null; entry: THREE.Vector3 | null } {
    const end = (t: number) => new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    const first = this.raycast(o, d, maxDist);
    if (!first) return { dist: maxDist, point: end(maxDist), penAt: null, entry: null };
    const stop = { dist: first.dist, point: first.point, penAt: null, entry: null };
    const thick = this.thickness(first.point, d, first.box);
    if (thick <= 0 || thick > PEN_MAX_THICK) return stop;
    const exit = first.dist + thick + EPS * 4;
    if (exit >= maxDist) return stop;
    const second = this.raycast(end(exit), d, maxDist - exit);
    return {
      dist: second ? exit + second.dist : maxDist,
      point: second ? second.point : end(maxDist),
      penAt: first.dist,
      entry: first.point,
    };
  }

  hasLineOfSight(a: THREE.Vector3, b: THREE.Vector3) {
    const d = this._los.subVectors(b, a);
    const dist = d.length();
    if (dist < 0.01) return true;
    d.multiplyScalar(1 / dist);
    return this.rayHitT(a, d, dist - 0.2, false) < 0;
  }

  groundY(x: number, z: number, fromY = 40) {
    const o = new THREE.Vector3(x, fromY, z);
    const d = new THREE.Vector3(0, -1, 0);
    const hit = this.raycast(o, d, 80);
    return hit ? hit.point.y : 0;
  }
}

function rayAabb(o: THREE.Vector3, d: THREE.Vector3, b: Collider, maxT: number): number | null {
  let tmin = 0;
  let tmax = maxT;
  const slab = (origin: number, dir: number, min: number, max: number) => {
    if (Math.abs(dir) < 1e-8) return origin < min || origin > max ? false : true;
    const inv = 1 / dir;
    let t1 = (min - origin) * inv;
    let t2 = (max - origin) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!slab(o.x, d.x, b.minx, b.maxx)) return null;
  if (!slab(o.y, d.y, b.miny, b.maxy)) return null;
  if (!slab(o.z, d.z, b.minz, b.maxz)) return null;
  return tmin;
}

export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number, maxDist: number) {
  const vx = c.x - o.x,
    vy = c.y - o.y,
    vz = c.z - o.z;
  const tca = vx * d.x + vy * d.y + vz * d.z;
  if (tca < 0 || tca > maxDist + r) return null;
  const d2 = vx * vx + vy * vy + vz * vz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return null;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc;
  if (t < 0 || t > maxDist) return null;
  return t;
}
