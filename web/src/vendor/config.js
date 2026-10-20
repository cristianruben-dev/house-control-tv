// Loads and normalises a floor plan ("home.json"). Everything the 3D scene and the UI
// know about the apartment comes from this one document, so swapping the file swaps the home.

const LIGHT_TYPES = ['ceiling', 'pendant', 'spots', 'floor', 'table', 'strip'];
const WALLS = ['north', 'south', 'east', 'west'];

export class ConfigError extends Error {}

export const LIGHT_KINDS = LIGHT_TYPES;

// A lamp or an AC is real when it is linked to a device of a connected platform:
// `link: { service, id }` (Home Assistant, Philips Hue, Apple Home). An AC's `sensor: { service, id }` is a thermometer for its room.
export const LINK_FIELDS = ['link', 'sensor'];

export function linkOf(d) {
  if (d?.link?.service && d.link.id) return { service: d.link.service, id: d.link.id };
  return null;
}

export const isLinked = (d) => Boolean(linkOf(d));

/** The platforms House Control can link to, in the order the editor lists them. */
export const SERVICES = {
  homeassistant: { name: 'Home Assistant', short: 'Home Assistant' },
  hue: { name: 'Philips Hue', short: 'Hue' },
  homekit: { name: 'Apple Home', short: 'Apple Home' },
};
export const FLOOR_KINDS = ['oak', 'walnut', 'tile', 'stone', 'tileWhite', 'tileBlue'];

// The plan exactly as written on disk (the editor works on this form).
export async function loadRawConfig() {
  const boot = window.__HOUSE_BOOT__;
  if (boot?.config) return boot.config;
  const plan = (boot?.plan !== 'custom' && boot?.plan) || new URLSearchParams(location.search).get('plan') || 'home';
  const res = await fetch(`./plans/${plan}.json`);
  if (!res.ok) throw new ConfigError(`No se encontró el plano "${plan}" (HTTP ${res.status})`);
  try {
    return await res.json();
  } catch (e) {
    throw new ConfigError(`El plano "${plan}" no es un JSON válido: ${e.message}`);
  }
}

export async function loadConfig() {
  return normalize(await loadRawConfig());
}

function need(cond, msg) {
  if (!cond) throw new ConfigError(msg);
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

export function normalize(raw) {
  need(raw && typeof raw === 'object', 'El plano debe ser un objeto JSON');
  need(Array.isArray(raw.rooms) && raw.rooms.length > 0, 'El plano necesita al menos un cuarto en "rooms"');

  const ids = new Set();
  const unique = (id, what) => {
    need(typeof id === 'string' && id, `A ${what} le falta un "id"`);
    need(!ids.has(id), `Id repetido "${id}"`);
    ids.add(id);
  };

  const rooms = raw.rooms.map((r) => {
    unique(r.id, 'un cuarto');
    need(Array.isArray(r.rect) && r.rect.length === 4 && r.rect.every(Number.isFinite),
      `El cuarto "${r.id}" necesita "rect": [x, z, ancho, fondo]`);
    const [x, z, w, d] = r.rect;
    need(w > 0 && d > 0, `El cuarto "${r.id}" tiene un rect vacío`);
    // `wall` optionally paints (or tiles) the inner faces of the room's walls, e.g. "#3f7fc1".
    return { id: r.id, name: r.name || r.id, x, z, w, d, floor: r.floor || 'oak', wall: typeof r.wall === 'string' ? r.wall : null };
  });
  const roomIds = new Set(rooms.map((r) => r.id));

  const openings = (raw.openings || []).map((o, i) => {
    need(isPoint(o.from) && isPoint(o.to), `La abertura #${i + 1} necesita los puntos "from" y "to"`);
    need(o.from[0] === o.to[0] || o.from[1] === o.to[1], `La abertura #${i + 1} debe ir alineada a los ejes`);
    return { type: o.type || 'door', from: o.from, to: o.to, sill: o.sill ?? 0.85, head: o.head ?? 2.1 };
  });

  const lights = (raw.lights || []).map((l) => {
    unique(l.id, 'una luz');
    need(roomIds.has(l.room), `La luz "${l.id}" apunta al cuarto desconocido "${l.room}"`);
    need(LIGHT_TYPES.includes(l.type), `La luz "${l.id}" tiene el tipo desconocido "${l.type}" (usa ${LIGHT_TYPES.join(', ')})`);
    need(isPoint(l.pos), `La luz "${l.id}" necesita "pos": [x, z]`);
    return {
      ...l,
      name: l.name || l.id,
      rot: l.rot || 0,
      capabilities: l.capabilities || [], // plain smart plugs: on/off only
    };
  });

  const acs = (raw.acs || []).map((a) => {
    unique(a.id, 'un aire');
    need(roomIds.has(a.room), `El aire "${a.id}" apunta al cuarto desconocido "${a.room}"`);
    need(isPoint(a.pos), `El aire "${a.id}" necesita "pos": [x, z]`);
    need(WALLS.includes(a.wall), `El aire "${a.id}" necesita "wall": una de ${WALLS.join(', ')}`);
    return { ...a, name: a.name || a.id, y: a.y ?? 2.2, min: a.min ?? 16, max: a.max ?? 30 };
  });

  const scenes = (raw.scenes || []).map((s) => {
    need(typeof s.id === 'string' && s.id, 'A una escena le falta un "id"');
    return { id: s.id, name: s.name || s.id, icon: s.icon || 'sun', lights: s.lights || {}, acs: s.acs || {} };
  });

  const minX = Math.min(...rooms.map((r) => r.x));
  const minZ = Math.min(...rooms.map((r) => r.z));
  const maxX = Math.max(...rooms.map((r) => r.x + r.w));
  const maxZ = Math.max(...rooms.map((r) => r.z + r.d));

  return {
    name: raw.name || 'Casa',
    wallHeight: raw.wallHeight ?? 2.6,
    interiorWallHeight: raw.interiorWallHeight ?? 1.25,
    camera: { azimuth: raw.camera?.azimuth ?? 34, elevation: raw.camera?.elevation ?? 47 },
    outdoorTemp: raw.outdoorTemp ?? 27,
    rooms,
    openings,
    furniture: raw.furniture || [],
    // Optional lawn around the house: { margin, color }.
    yard: raw.yard ? { margin: raw.yard.margin ?? 1.5, color: raw.yard.color || '#6e9b4c' } : null,
    lights,
    acs,
    scenes,
    bounds: { minX, minZ, maxX, maxZ },
  };
}
