import * as THREE from "three";

export interface Collider {
  minx: number;
  miny: number;
  minz: number;
  maxx: number;
  maxy: number;
  maxz: number;
  noShoot?: boolean;
}

const EPS = 0.002;

export class World {
  boxes: Collider[] = [];
  bounds = { minX: -42, maxX: 42, minZ: -42, maxZ: 42 };

  clear() {
    this.boxes.length = 0;
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
    // which way the last wall pushed back, so a wall jump has something to kick off
    let wallNormal: THREE.Vector3 | null = null;

    // vertical
    const prevY = pos.y;
    pos.y += vel.y * dt;
    {
      const minx = pos.x - halfW,
        maxx = pos.x + halfW;
      const miny = pos.y,
        maxy = pos.y + height;
      const minz = pos.z - halfW,
        maxz = pos.z + halfW;
      for (const b of this.boxes) {
        if (!this.overlaps(b, minx, miny, minz, maxx, maxy, maxz)) continue;
        // Land if the feet were at or above this surface *before* the step. The
        // post-move test alone let anything falling fast enough clear the
        // threshold in one frame and drop straight through the floor — which is
        // how bots ended up under the map, apparently outside it.
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
      for (const b of this.boxes) {
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
      // last resort: put them back on whatever solid ground is above, not at
      // y=0, which could be inside a building
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
    for (const b of this.boxes) {
      if (this.overlaps(b, minx, miny, minz, maxx, maxy, maxz)) return true;
    }
    return false;
  }

  raycast(
    o: THREE.Vector3,
    d: THREE.Vector3,
    maxDist: number,
    skipNoShoot = false,
  ): { dist: number; point: THREE.Vector3; nx: number; ny: number; nz: number } | null {
    let best = maxDist;
    let hit = false;
    let nx = 0,
      ny = 1,
      nz = 0;
    for (const b of this.boxes) {
      if (skipNoShoot && b.noShoot) continue;
      const t = rayAabb(o, d, b, best);
      if (t !== null && t < best && t >= 0) {
        best = t;
        hit = true;
        const px = o.x + d.x * t,
          py = o.y + d.y * t,
          pz = o.z + d.z * t;
        const e = 0.02;
        nx = ny = nz = 0;
        if (Math.abs(px - b.minx) < e) nx = -1;
        else if (Math.abs(px - b.maxx) < e) nx = 1;
        else if (Math.abs(py - b.miny) < e) ny = -1;
        else if (Math.abs(py - b.maxy) < e) ny = 1;
        else if (Math.abs(pz - b.minz) < e) nz = -1;
        else nz = 1;
      }
    }
    if (!hit) return null;
    return { dist: best, point: new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best), nx, ny, nz };
  }

  hasLineOfSight(a: THREE.Vector3, b: THREE.Vector3) {
    const d = new THREE.Vector3().subVectors(b, a);
    const dist = d.length();
    if (dist < 0.01) return true;
    d.multiplyScalar(1 / dist);
    const hit = this.raycast(a, d, dist - 0.2);
    return !hit;
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
  const axes: Array<["x" | "y" | "z", number, number]> = [
    ["x", b.minx, b.maxx],
    ["y", b.miny, b.maxy],
    ["z", b.minz, b.maxz],
  ];
  for (const [axis, min, max] of axes) {
    const origin = o[axis];
    const dir = d[axis];
    if (Math.abs(dir) < 1e-8) {
      if (origin < min || origin > max) return null;
    } else {
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
      if (tmin > tmax) return null;
    }
  }
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
