/**
 * `display` transforms — docs/11 §10.2. Minecraft applies a per-slot rotate → translate →
 * scale to the model when it is held, worn, dropped or drawn in the inventory; this module
 * turns a slot into a model matrix and supplies vanilla's own slot defaults so an empty slot
 * previews the way Minecraft would actually draw it.
 *
 * Minecraft's order (ItemTransform#apply): translate to the block centre, then
 * translation → rotation → scale, then back. Translations are in 1/16 block units and
 * clamped to ±80; scale is clamped to 4.
 */
import type { DisplaySlot, DisplaySlotName, Vec3 } from './types';
import { DEG, multiply, rotationX, rotationY, rotationZ, translation, type Mat4 } from './vec';
import { vec3 } from './types';

const ZERO = (): Vec3 => vec3(0, 0, 0);
const ONE = (): Vec3 => vec3(1, 1, 1);

export const clampTranslation = (v: number): number => Math.max(-80, Math.min(80, v));
export const clampScale = (v: number): number => Math.max(-4, Math.min(4, v));

/**
 * Vanilla's block-model display defaults (`minecraft:block/block`), the baseline a block model
 * inherits when it declares no `display` of its own.
 */
export const VANILLA_BLOCK_DISPLAY: Partial<Record<DisplaySlotName, DisplaySlot>> = {
  gui: { rotation: vec3(30, 225, 0), translation: ZERO(), scale: vec3(0.625, 0.625, 0.625) },
  head: { rotation: ZERO(), translation: ZERO(), scale: ONE() },
  ground: { rotation: ZERO(), translation: vec3(0, 3, 0), scale: vec3(0.25, 0.25, 0.25) },
  fixed: { rotation: ZERO(), translation: ZERO(), scale: vec3(0.5, 0.5, 0.5) },
  thirdperson_righthand: {
    rotation: vec3(75, 45, 0),
    translation: vec3(0, 2.5, 0),
    scale: vec3(0.375, 0.375, 0.375),
  },
  firstperson_righthand: {
    rotation: vec3(0, 45, 0),
    translation: ZERO(),
    scale: vec3(0.4, 0.4, 0.4),
  },
  firstperson_lefthand: {
    rotation: vec3(0, 225, 0),
    translation: ZERO(),
    scale: vec3(0.4, 0.4, 0.4),
  },
};

/** The slot as Minecraft would use it: the model's own values over the vanilla default. */
export function effectiveSlot(
  slot: DisplaySlotName,
  display: Partial<Record<DisplaySlotName, DisplaySlot>> | undefined,
): DisplaySlot {
  const mine = display?.[slot];
  const base =
    VANILLA_BLOCK_DISPLAY[slot] ??
    // thirdperson_lefthand mirrors the right hand's yaw when neither is declared.
    (slot === 'thirdperson_lefthand'
      ? {
          rotation: vec3(75, 315, 0),
          translation: vec3(0, 2.5, 0),
          scale: vec3(0.375, 0.375, 0.375),
        }
      : { rotation: ZERO(), translation: ZERO(), scale: ONE() });
  return {
    rotation: mine?.rotation ?? base.rotation ?? ZERO(),
    translation: mine?.translation ?? base.translation ?? ZERO(),
    scale: mine?.scale ?? base.scale ?? ONE(),
  };
}

const scaleMatrix = (v: Vec3): Mat4 =>
  new Float32Array([v.x, 0, 0, 0, 0, v.y, 0, 0, 0, 0, v.z, 0, 0, 0, 0, 1]);

/**
 * The slot's model matrix in MODEL UNITS (0..16 space), pivoting about the block centre so a
 * scaled or spun preview stays where the model is rather than flying off toward the origin.
 */
export function displayMatrix(slot: DisplaySlot): Mat4 {
  const t = slot.translation ?? ZERO();
  const r = slot.rotation ?? ZERO();
  const s = slot.scale ?? ONE();
  const centre = vec3(8, 8, 8);
  // Minecraft's own order, in its own units: translate (1/16 units → model units is 1:1 here),
  // then rotate z→y→x as applied by ItemTransform, then scale.
  let m = translation(centre);
  m = multiply(
    m,
    translation(vec3(clampTranslation(t.x), clampTranslation(t.y), clampTranslation(t.z))),
  );
  m = multiply(m, rotationX(r.x * DEG));
  m = multiply(m, rotationY(r.y * DEG));
  m = multiply(m, rotationZ(r.z * DEG));
  m = multiply(m, scaleMatrix(vec3(clampScale(s.x), clampScale(s.y), clampScale(s.z))));
  return multiply(m, translation(vec3(-centre.x, -centre.y, -centre.z)));
}

/** Human label for the slot chips. */
export const DISPLAY_LABEL: Record<DisplaySlotName, string> = {
  thirdperson_righthand: '3rd R',
  thirdperson_lefthand: '3rd L',
  firstperson_righthand: '1st R',
  firstperson_lefthand: '1st L',
  gui: 'GUI',
  head: 'Head',
  ground: 'Ground',
  fixed: 'Frame',
};
