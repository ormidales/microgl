import type { EntityManager } from './EntityManager';

/**
 * Abstract base class for all ECS systems.
 *
 * A system declares the component types it requires and is updated once per
 * frame. The `EntityManager` is used to query entities matching the required
 * component signature.
 */
export abstract class System {
  /** Component types this system operates on. */
  public abstract readonly requiredComponents: readonly string[];

  /** Called once per frame with the entity manager and frame delta time. */
  abstract update(em: EntityManager, deltaTime: number): void;

  /**
   * Fault-tolerant wrapper around {@link update}.
   *
   * Catches any error thrown by `update`, logs it via `console.error`, and
   * returns without re-throwing so that the render loop continues running.
   */
  safeUpdate(em: EntityManager, deltaTime: number): void {
    try {
      this.update(em, deltaTime);
    } catch (err) {
      console.error(`[${this.constructor.name}] uncaught error in update():`, err);
    }
  }
}
