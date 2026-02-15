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
  /** query-signature → cached matching entities */
  private readonly views: Map<string, { componentTypes: string[]; entities: Set<EntityId> }> = new Map();
  /** component-type → query-signatures that include this component */
  private readonly viewKeysByComponentType: Map<string, Set<string>> = new Map();

  // ---------------------------------------------------------------------------
  // Entity lifecycle
  // ---------------------------------------------------------------------------

  /** Create a new entity and return its id. */
  createEntity(): EntityId {
    const id = this.nextId++;
    this.entities.add(id);
    this.signatures.set(id, new Set());
    this.views.get('')?.entities.add(id);
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
    this.removeEntityFromViews(id);
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

    const signature = this.signatures.get(id);
    signature?.add(cType);
    if (signature) this.updateEntityInViews(id, signature, cType);
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

    const signature = this.signatures.get(id);
    signature?.delete(componentType);
    if (signature) this.updateEntityInViews(id, signature, componentType);
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
    const key = this.getViewKey(componentTypes);
    let view = this.views.get(key);
    if (!view) {
      const normalizedTypes = key ? key.split('|') : [];
      const entities = new Set<EntityId>();
      for (const [id, sig] of this.signatures) {
        if (normalizedTypes.every((type) => sig.has(type))) {
          entities.add(id);
        }
      }
      view = { componentTypes: normalizedTypes, entities };
      this.views.set(key, view);
      for (const type of normalizedTypes) {
        let keys = this.viewKeysByComponentType.get(type);
        if (!keys) {
          keys = new Set<string>();
          this.viewKeysByComponentType.set(type, keys);
        }
        keys.add(key);
      }
    }
    return [...view.entities];
  }

  private getViewKey(componentTypes: string[]): string {
    if (componentTypes.length === 0) return '';
    if (componentTypes.length === 1) return componentTypes[0];

    let isSortedAndUnique = true;
    for (let i = 1; i < componentTypes.length; i++) {
      if (componentTypes[i - 1] >= componentTypes[i]) {
        isSortedAndUnique = false;
        break;
      }
    }

    if (isSortedAndUnique) {
      return componentTypes.join('|');
    }

    const normalized = componentTypes.slice().sort();
    let writeIndex = 1;
    for (let readIndex = 1; readIndex < normalized.length; readIndex++) {
      if (normalized[readIndex] !== normalized[writeIndex - 1]) {
        normalized[writeIndex++] = normalized[readIndex];
      }
    }
    normalized.length = writeIndex;
    return normalized.join('|');
  }

  private updateEntityInViews(id: EntityId, signature: Set<string>, changedComponentType?: string): void {
    const keys = changedComponentType
      ? this.viewKeysByComponentType.get(changedComponentType) ?? new Set<string>()
      : this.views.keys();
    for (const key of keys) {
      const view = this.views.get(key);
      if (!view) continue;
      if (view.componentTypes.every((type) => signature.has(type))) {
        view.entities.add(id);
      } else {
        view.entities.delete(id);
      }
    }
  }

  private removeEntityFromViews(id: EntityId): void {
    for (const view of this.views.values()) {
      view.entities.delete(id);
    }
  }
}
