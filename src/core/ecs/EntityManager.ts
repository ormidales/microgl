import type { EntityId, Component } from './types';

/**
 * Manages entities and their attached components.
 *
 * Entities are simple numeric identifiers. Components are stored per type
 * in `Map<EntityId, Component>` collections, enabling fast iteration by
 * component type.
 *
 * A bitmask signature is maintained for each entity so that systems can
 * quickly determine whether an entity owns a required set of components.
 */
export class EntityManager {
  private nextId: EntityId = 0;
  private readonly entities: Set<EntityId> = new Set();

  /** component-type → bit index */
  private readonly componentBits: Map<string, number> = new Map();
  private nextBit: number = 0;

  /** entity → bitmask of attached component types */
  private readonly signatures: Map<EntityId, number> = new Map();

  /** component-type → (entity → component) */
  private readonly stores: Map<string, Map<EntityId, Component>> = new Map();

  // ---------------------------------------------------------------------------
  // Entity lifecycle
  // ---------------------------------------------------------------------------

  /** Create a new entity and return its id. */
  createEntity(): EntityId {
    const id = this.nextId++;
    this.entities.add(id);
    this.signatures.set(id, 0);
    return id;
  }

  /** Remove an entity and all of its components. */
  destroyEntity(id: EntityId): void {
    if (!this.entities.has(id)) return;

    // Remove from every component store
    for (const store of this.stores.values()) {
      store.delete(id);
    }
    this.signatures.delete(id);
    this.entities.delete(id);
  }

  /** Return `true` if the entity exists. */
  hasEntity(id: EntityId): boolean {
    return this.entities.has(id);
  }

  // ---------------------------------------------------------------------------
  // Component management
  // ---------------------------------------------------------------------------

  /** Attach a component to an entity. */
  addComponent(id: EntityId, component: Component): void {
    if (!this.entities.has(id)) return;

    const cType = component.type;
    let store = this.stores.get(cType);
    if (!store) {
      store = new Map();
      this.stores.set(cType, store);
    }
    store.set(id, component);

    // Update bitmask
    const bit = this.getBit(cType);
    this.signatures.set(id, (this.signatures.get(id) ?? 0) | bit);
  }

  /** Remove a component type from an entity. */
  removeComponent(id: EntityId, componentType: string): void {
    const store = this.stores.get(componentType);
    if (store) {
      store.delete(id);
    }

    const bit = this.getBit(componentType);
    const sig = this.signatures.get(id);
    if (sig !== undefined) {
      this.signatures.set(id, sig & ~bit);
    }
  }

  /** Get a component instance for an entity, or `undefined`. */
  getComponent<T extends Component>(id: EntityId, componentType: string): T | undefined {
    return this.stores.get(componentType)?.get(id) as T | undefined;
  }

  /** Return `true` if the entity has the given component type. */
  hasComponent(id: EntityId, componentType: string): boolean {
    return !!(this.stores.get(componentType)?.has(id));
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Return all entity ids that possess **every** component type listed.
   * Uses bitmask comparison for fast filtering.
   */
  getEntitiesWith(...componentTypes: string[]): EntityId[] {
    const mask = componentTypes.reduce((m, t) => m | this.getBit(t), 0);
    const result: EntityId[] = [];
    for (const [id, sig] of this.signatures) {
      if ((sig & mask) === mask) {
        result.push(id);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Return (and lazily assign) the bit index for a component type. */
  private getBit(componentType: string): number {
    let bit = this.componentBits.get(componentType);
    if (bit === undefined) {
      if (this.nextBit >= 31) {
        throw new Error(
          `EntityManager: exceeded maximum of 31 distinct component types.`,
        );
      }
      bit = 1 << this.nextBit++;
      this.componentBits.set(componentType, bit);
    }
    return bit;
  }
}
