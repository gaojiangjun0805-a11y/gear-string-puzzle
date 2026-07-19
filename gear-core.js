const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
export const APPROVED_TOOTH_COUNTS = [12, 16, 20, 24];
export const TOOTH_PITCH_RADIUS = 2.4;
export const TOOTH_DEPTH = 8;

// 外径 = 节圆半径 + 齿高；保持每一个齿在节圆上的弧长恒定。
export function gearRadius(teeth) { return Number(teeth) * TOOTH_PITCH_RADIUS + TOOTH_DEPTH; }
export function meshDistance(a, b) {
  const aPitchRadius = Number.isFinite(a.radius) ? a.radius - TOOTH_DEPTH : gearRadius(a.teeth) - TOOTH_DEPTH;
  const bPitchRadius = Number.isFinite(b.radius) ? b.radius - TOOTH_DEPTH : gearRadius(b.teeth) - TOOTH_DEPTH;
  return aPitchRadius + bPitchRadius;
}

// 橡皮筋未与钢钉绑定：收紧后只会接触包络线上的钢钉。
export function tautBandContacts(points) {
  const unique = [...new Map(points.map(point => [`${point.x},${point.y}`, point])).values()];
  if (unique.length <= 2) return unique;
  const sorted = [...unique].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const build = sequence => {
    const hull = [];
    for (const point of sequence) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull;
  };
  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function resolveBandPath(path, pegs, contactRadius = 14) {
  if (path.length < 2) return { path, contacts: [] };
  const contactById = new Map();
  const routed = [];
  for (let index = 0; index < path.length; index += 1) {
    const start = path[index]; const end = path[(index + 1) % path.length];
    routed.push(start);
    const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy || 1;
    const hits = pegs.map(peg => {
      const t = Math.max(0, Math.min(1, ((peg.x - start.x) * dx + (peg.y - start.y) * dy) / lengthSquared));
      const x = start.x + t * dx; const y = start.y + t * dy;
      return { peg, t, distance: Math.hypot(peg.x - x, peg.y - y) };
    }).filter(hit => hit.distance <= contactRadius).sort((a, b) => a.t - b.t);
    for (const hit of hits) {
      if (contactById.has(hit.peg.id)) continue;
      const contact = { ...hit.peg, t: hit.t };
      contactById.set(hit.peg.id, contact);
      routed.push(contact);
    }
  }
  return { path: routed, contacts: [...contactById.values()] };
}

export function meshReport(gears, tolerance = 8) {
  const contacts = new Map(gears.map(gear => [gear.id, []]));
  for (let index = 0; index < gears.length; index += 1) {
    for (let next = index + 1; next < gears.length; next += 1) {
      const a = gears[index];
      const b = gears[next];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const contactDistance = meshDistance(a, b);
      if (Math.abs(distance - contactDistance) <= tolerance) {
        contacts.get(a.id).push(b.id);
        contacts.get(b.id).push(a.id);
      }
    }
  }
  return { contacts, isolated: gears.filter(gear => contacts.get(gear.id).length === 0).map(gear => gear.id) };
}

export function buildGearAngles(gears, driverId, driverAngle) {
  const byId = new Map(gears.map(gear => [gear.id, gear]));
  const angles = new Map([[driverId, driverAngle]]);
  const queue = [driverId];

  while (queue.length) {
    const id = queue.shift();
    const gear = byId.get(id);
    if (!gear) continue;
    for (const neighborId of gear.contacts || []) {
      if (angles.has(neighborId)) continue;
      const neighbor = byId.get(neighborId);
      if (!neighbor) continue;
      const angle = -angles.get(id) * gear.teeth / neighbor.teeth;
      angles.set(neighborId, angle);
      queue.push(neighborId);
    }
  }
  return angles;
}

export function mapHole(gear, hole, angle) {
  const degreesPerHole = 360 / gear.holeCount;
  return mod(Math.round(hole + angle / degreesPerHole), gear.holeCount);
}

export function deriveStartBands(question) {
  const angles = buildGearAngles(question.gears, question.driver.id, question.driver.angle);
  const byId = new Map(question.gears.map(gear => [gear.id, gear]));
  return question.bands.map(band => ({
    ...band,
    points: band.points.map(point => ({
      ...point,
      hole: mapHole(byId.get(point.gearId), point.hole, -(angles.get(point.gearId) || 0)),
    })),
  }));
}

export function validateQuestion(question) {
  const errors = [];
  const gears = new Map((question.gears || []).map(gear => [gear.id, gear]));
  if (!gears.size) errors.push('请至少配置一个齿轮。');
  if (!gears.has(question.driver?.id)) errors.push('主动齿轮无效。');
  for (const gear of gears.values()) {
    if (!APPROVED_TOOTH_COUNTS.includes(Number(gear.teeth))) errors.push(`${gear.id.toUpperCase()} 的齿数只能为 12、16、20 或 24 齿。`);
  }
  for (const [index, band] of (question.bands || []).entries()) {
    if (!Number.isFinite(Number(band.length)) || Number(band.length) <= 0) errors.push(`橡皮筋 ${index + 1} 需要正确的长度。`);
    for (const point of band.points || []) {
      const gear = gears.get(point.gearId);
      if (!gear || !Number.isInteger(point.hole) || point.hole < 0 || point.hole >= gear.holeCount) {
        errors.push('钢钉必须插在对应齿轮的外圈孔上。');
        break;
      }
    }
    const hasDrawnPath = Array.isArray(band.path) && band.path.length >= 3;
    if (!hasDrawnPath && (!Array.isArray(band.points) || band.points.length < 3)) errors.push(`橡皮筋 ${index + 1} 至少需要三个孔位或一条闭合绘制轨迹。`);
  }
  return { valid: errors.length === 0, errors };
}

export function scoreDifficulty(question) {
  const angles = buildGearAngles(question.gears, question.driver.id, question.driver.angle);
  const activeGears = new Set((question.pegs || question.bands.flatMap(band => band.points)).map(point => point.gearId));
  const corners = question.bands.reduce((sum, band) => sum + (band.path?.length || band.points.length), 0);
  const ratios = [...angles.values()].filter(angle => Math.abs(angle) > 0.001).length;
  const precision = 360 / Math.max(...question.gears.map(gear => gear.holeCount));
  const raw = activeGears.size * 1.4 + corners * 0.85 + question.bands.length * 2.4 + ratios * 0.6 + Math.abs(question.driver.angle) / 90;
  const rating = raw < 12 ? '入门' : raw < 20 ? '进阶' : raw < 30 ? '高难' : '专家';
  return {
    rating,
    raw: Number(raw.toFixed(1)),
    activeGearCount: activeGears.size,
    pegCount: corners,
    bandCount: question.bands.length,
    routeCorners: corners,
    drivenGearCount: angles.size,
    anglePrecision: precision,
  };
}

export function mechanicalUniqueness(question) {
  const start = deriveStartBands(question);
  const seen = new Set();
  for (const band of start) {
    const signature = band.path?.length ? band.path.map(point => `${Math.round(point.x)}:${Math.round(point.y)}`).join('|') : band.points.map(point => `${point.gearId}:${point.hole}`).join('|');
    if (seen.has(signature)) return { unique: false, reason: '存在完全重复的橡皮筋路径。' };
    seen.add(signature);
  }
  return { unique: true, reason: '固定目标路径和驱动角度下，孔位反推结果唯一。' };
}
