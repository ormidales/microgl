/**
 * Unique identifier for an entity.
 */
export type EntityId = number;

/**
 * Base interface for all components.
 * Each component type must declare a unique `type` string.
 */
export interface Component {
  readonly type: string;
}
