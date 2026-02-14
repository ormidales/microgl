import type { EntityId, Component } from './types';

/**
 * Manages entities and their attached components.
 *
 * Entities are simple numeric identifiers. Components are stored per type
 * in `Map<EntityId, Component>` collections, enabling fast iteration by
 * component type.
 *
 * A signature set is maintained for each entity so that systems can
 * quickly determine whether an entity owns a required set of components.
 */
export class EntityManager {
  private nextId: EntityId = 0;
  private readonly entities: Set<EntityId> = new Set();

  /** entity → set of attached component types */
  private readonly signatures: Map<EntityId, Set<string>> = new Map();

  /** component-type → (entity → component) */
  private readonly stores: Map<string, Map<EntityId, Component>> = new Map();

  // ---------------------------------------------------------------------------
  // Entity lifecycle
  // ---------------------------------------------------------------------------

  /** Create a new entity and return its id. */
  createEntity(): EntityId {
    const id = this.nextId++;
    this.entities.add(id);
    this.signatures.set(id, new Set());
    return id;
  }

  /** Remove an entity and all of its components. */
  destroyEntity(id: EntityId): void {
    if (!this.entities.has(id)) return;

    // Remove from every component store
    for (const [componentType, store] of this.stores) {
      store.delete(id);
      if (store.size === 0) {
        this.stores.delete(componentType);
      }
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

    this.signatures.get(id)?.add(cType);
  }

  /** Remove a component type from an entity. */
  removeComponent(id: EntityId, componentType: string): void {
    const store = this.stores.get(componentType);
    if (store) {
      store.delete(id);
      if (store.size === 0) {
        this.stores.delete(componentType);
      }
    }

    this.signatures.get(id)?.delete(componentType);
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
   */
  getEntitiesWith(...componentTypes: string[]): EntityId[] {
    const result: EntityId[] = [];
    for (const [id, sig] of this.signatures) {
      if (componentTypes.every((type) => sig.has(type))) {
        result.push(id);
      }
    }
    return result;
  }
}
