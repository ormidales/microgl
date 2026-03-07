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
 *
 * Components may optionally implement {@link dispose} to release internal
 * references (e.g. large typed arrays) when the owning entity is destroyed.
 * {@link EntityManager.destroyEntity} calls this hook automatically so that
 * component data is nullified as soon as the entity is gone, rather than
 * waiting for the next garbage-collection cycle.
 */
export interface Component {
  readonly type: string;
  /** Release internal references held by this component. Called by {@link EntityManager.destroyEntity}. */
  dispose?(): void;
}
