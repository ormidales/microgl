/**
 * Unique identifier for an entity.
 */
export type EntityId = number;

/**
 * A quaternion represented as a strict four-element tuple `[x, y, z, w]`.
 * Using a tuple (rather than `number[]`) lets TypeScript enforce the exact
 * length at compile time, preventing silent matrix-computation failures caused
 * by arrays with the wrong number of elements.
 *
 * The caller is responsible for ensuring the quaternion is normalised before
 * passing it to systems that build rotation matrices (e.g. {@link RenderSystem}).
 */
export type Quaternion = [number, number, number, number];

/**
 * Base interface for all components.
 * Each component type must declare a unique `type` string.
 */
export interface Component {
  readonly type: string;
}
