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
  private readonly freeIds: EntityId[] = [];
  private readonly entities: Set<EntityId> = new Set();

  /** entity → set of attached component types */
  private readonly signatures: Map<EntityId, Set<string>> = new Map();

  /** component-type → (entity → component) */
  private readonly stores: Map<string, Map<EntityId, Component>> = new Map();
  /** query-signature → cached matching entities */
  private readonly views: Map<string, { componentTypes: string[]; entities: Set<EntityId> }> = new Map();
  /** component-type → query-signatures that include this component */
  private readonly viewKeysByComponentType: Map<string, Set<string>> = new Map();
  /** component instance → number of entities that currently reference it */
  private readonly componentRefCounts: WeakMap<Component, number> = new WeakMap();

  // ---------------------------------------------------------------------------
  // Entity lifecycle
  // ---------------------------------------------------------------------------

  /** Create a new entity and return its id. */
  createEntity(): EntityId {
    const id = this.freeIds.length > 0 ? this.freeIds.pop()! : this.nextId++;
    this.entities.add(id);
    this.signatures.set(id, new Set());
    this.views.get('')?.entities.add(id);
    return id;
  }

  /** Remove an entity and all of its components. */
  destroyEntity(id: EntityId): void {
    if (!this.entities.has(id)) return;

    // Remove only from stores for component types the entity actually owns.
    // Decrement each component's reference count and dispose it only when the
    // count reaches zero (i.e. no other entity holds the same instance).
    const signature = this.signatures.get(id);
    if (signature) {
      for (const componentType of signature) {
        const store = this.stores.get(componentType);
        if (store) {
          const component = store.get(id);
          if (component) this.decrementRefCount(component);
          store.delete(id);
          if (store.size === 0) {
            this.stores.delete(componentType);
          }
        }
      }
    }
    this.removeEntityFromViews(id);
    this.signatures.delete(id);
    this.entities.delete(id);
    this.freeIds.push(id);
  }

  /** Return `true` if the entity exists. */
  hasEntity(id: EntityId): boolean {
    return this.entities.has(id);
  }

  // ---------------------------------------------------------------------------
  // Component management
  // ---------------------------------------------------------------------------

  /**
   * Attach a component to an entity.
   *
   * If the entity already holds a **different** instance of the same component
   * type, the old instance's reference count is decremented (and it is disposed
   * when it reaches zero). The new instance's reference count is incremented.
   * Attaching the **same** instance that is already attached is a no-op with
   * respect to ref-counting.
   */
  addComponent(id: EntityId, component: Component): void {
    if (!this.entities.has(id)) return;

    const cType = component.type;
    let store = this.stores.get(cType);
    if (!store) {
      store = new Map();
      this.stores.set(cType, store);
    }

    // If an existing component of the same type is being replaced, decrement
    // the old instance's reference count (and dispose it when it hits zero).
    const existing = store.get(id);
    if (existing !== undefined && existing !== component) {
      this.decrementRefCount(existing);
    }

    // Increment the reference count for the incoming component only when the
    // entity doesn't already hold this exact same instance.
    if (existing !== component) {
      this.incrementRefCount(component);
    }

    store.set(id, component);

    const signature = this.signatures.get(id);
    if (signature && !signature.has(cType)) {
      signature.add(cType);
      this.updateEntityInViews(id, signature, cType);
    }
  }

  /**
   * Remove a component type from an entity.
   *
   * Decrements the removed component's reference count; the component is
   * disposed when the count reaches zero. This method is a no-op if the entity
   * does not have the specified component type.
   */
  removeComponent(id: EntityId, componentType: string): void {
    if (!this.hasComponent(id, componentType)) return;

    const store = this.stores.get(componentType);
    if (store) {
      const component = store.get(id);
      if (component) this.decrementRefCount(component);
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
   * Invoke `cb` once for every entity that possesses **every** component type
   * listed in `types`.  Iterates directly over the cached view's `Set` without
   * allocating a temporary array, making it suitable for use in hot loops such
   * as render and physics updates.
   */
  forEachEntityWith(types: readonly string[], cb: (entity: EntityId) => void): void {
    for (const id of this.getOrCreateView(types).entities) {
      cb(id);
    }
  }

  /**
   * Return all entity ids that possess **every** component type listed.
   *
   * @deprecated Prefer {@link forEachEntityWith} in hot loops — this method
   * allocates a new array on every call, which increases GC pressure at high
   * frame rates.  `getEntitiesWith` is kept for convenience and backward
   * compatibility.
   */
  getEntitiesWith(...componentTypes: string[]): EntityId[] {
    return [...this.getOrCreateView(componentTypes).entities];
  }

  private getOrCreateView(types: readonly string[]): { componentTypes: string[]; entities: Set<EntityId> } {
    const key = this.getViewKey(types);
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
    return view;
  }

  private getViewKey(componentTypes: readonly string[]): string {
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
    // Snapshot keys before iterating – deleteView mutates both `views` and
    // `viewKeysByComponentType` during the loop, so a live reference would
    // cause entries to be skipped when the current key is deleted from the Set.
    const keys = changedComponentType
      ? [...(this.viewKeysByComponentType.get(changedComponentType) ?? [])]
      : [...this.views.keys()];
    for (const key of keys) {
      const view = this.views.get(key);
      if (!view) continue;
      if (view.componentTypes.every((type) => signature.has(type))) {
        view.entities.add(id);
      } else {
        view.entities.delete(id);
        if (view.entities.size === 0) {
          this.deleteView(key, view.componentTypes);
        }
      }
    }
  }

  private removeEntityFromViews(id: EntityId): void {
    // Snapshot entries before iterating – deleteView removes keys from `views`
    // during the loop; iterating a live Map while deleting from it can skip
    // entries that haven't been visited yet.
    for (const [key, view] of [...this.views]) {
      view.entities.delete(id);
      if (view.entities.size === 0) {
        this.deleteView(key, view.componentTypes);
      }
    }
  }

  /**
   * Remove all cached views that currently contain no entities.
   *
   * Call this after a batch of one-off `getEntitiesWith` queries to prevent
   * the internal view cache from growing without bound. Do **not** call this
   * inside the render loop — view creation has a one-time cost that amortises
   * across frames.
   *
   * @example
   * // After procedural level generation that queried many ad-hoc component sets:
   * generateLevel(em);
   * em.clearEmptyViews();
   */
  clearEmptyViews(): void {
    for (const [key, view] of [...this.views]) {
      if (view.entities.size === 0) {
        this.deleteView(key, view.componentTypes);
      }
    }
  }

  private deleteView(key: string, componentTypes: string[]): void {
    this.views.delete(key);
    for (const componentType of componentTypes) {
      const keys = this.viewKeysByComponentType.get(componentType);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) {
        this.viewKeysByComponentType.delete(componentType);
      }
    }
  }

  /** Increment the reference count for a disposable component instance. */
  private incrementRefCount(component: Component): void {
    if (!component.dispose) return;
    this.componentRefCounts.set(component, (this.componentRefCounts.get(component) ?? 0) + 1);
  }

  /**
   * Decrement the reference count for `component` and call `dispose()` when
   * the count reaches zero.  O(1) — no store scan required.
   */
  private decrementRefCount(component: Component): void {
    if (!component.dispose) return;
    const count = this.componentRefCounts.get(component) ?? 0;
    if (count <= 1) {
      this.componentRefCounts.delete(component);
      component.dispose();
    } else {
      this.componentRefCounts.set(component, count - 1);
    }
  }
}
