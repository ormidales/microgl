import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EntityManager } from '../src/core/ecs/EntityManager';
import { System } from '../src/core/ecs/System';
import { TransformComponent } from '../src/core/ecs/components/TransformComponent';
import { MeshComponent } from '../src/core/ecs/components/MeshComponent';
import { CameraComponent } from '../src/core/ecs/components/CameraComponent';
import { RenderSystem } from '../src/core/ecs/systems/RenderSystem';
import { OrbitalCameraSystem } from '../src/core/ecs/systems/OrbitalCameraSystem';
import { mat4, quat, vec3 } from 'gl-matrix';

// ---------------------------------------------------------------------------
// EntityManager
// ---------------------------------------------------------------------------

describe('EntityManager', () => {
  it('creates entities with unique ids', () => {
    const em = new EntityManager();
    const a = em.createEntity();
    const b = em.createEntity();
    expect(a).not.toBe(b);
    expect(em.hasEntity(a)).toBe(true);
    expect(em.hasEntity(b)).toBe(true);
  });

  it('destroys entities and their components', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.destroyEntity(id);

    expect(em.hasEntity(id)).toBe(false);
    expect(em.hasComponent(id, 'Transform')).toBe(false);
  });

  it('adds and retrieves components', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const t = new TransformComponent(1, 2, 3);
    em.addComponent(id, t);

    const got = em.getComponent<TransformComponent>(id, 'Transform');
    expect(got).toBe(t);
    expect(got?.x).toBe(1);
    expect(got?.y).toBe(2);
    expect(got?.z).toBe(3);
  });

  it('removes components', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.removeComponent(id, 'Transform');

    expect(em.hasComponent(id, 'Transform')).toBe(false);
    expect(em.getComponent(id, 'Transform')).toBeUndefined();
  });

  it('removeComponent is a no-op when entity does not have the component', () => {
    const em = new EntityManager();
    const id = em.createEntity();

    // Calling removeComponent on a type the entity never had should not throw
    // and should not alter any state.
    em.removeComponent(id, 'NonExistent');
    expect(em.hasComponent(id, 'NonExistent')).toBe(false);
    // Views and signatures must remain untouched
    expect((em as any).signatures.get(id).size).toBe(0);
    expect((em as any).stores.has('NonExistent')).toBe(false);
  });

  it('prunes empty component store on removeComponent', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.removeComponent(id, 'Transform');

    expect((em as any).stores.has('Transform')).toBe(false);
  });

  it('getEntitiesWith filters by bitmask', () => {
    const em = new EntityManager();
    const a = em.createEntity();
    const b = em.createEntity();
    const c = em.createEntity();

    em.addComponent(a, new TransformComponent());
    em.addComponent(a, new MeshComponent());

    em.addComponent(b, new TransformComponent());

    em.addComponent(c, new MeshComponent());

    const both = em.getEntitiesWith('Transform', 'Mesh');
    expect(both).toEqual([a]);

    const transforms = em.getEntitiesWith('Transform');
    expect(transforms).toContain(a);
    expect(transforms).toContain(b);
    expect(transforms).not.toContain(c);
  });

  it('reuses cached views for equivalent component queries', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(id, new MeshComponent());

    em.getEntitiesWith('Transform', 'Mesh');
    em.getEntitiesWith('Mesh', 'Transform');

    expect((em as any).views.size).toBe(1);
  });

  it('reuses cached views when query contains duplicate component types', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(id, new MeshComponent());

    em.getEntitiesWith('Transform', 'Mesh');
    expect(em.getEntitiesWith('Transform', 'Mesh', 'Transform')).toEqual([id]);

    expect((em as any).views.size).toBe(1);
  });

  it('keeps cached views in sync when components change', () => {
    const em = new EntityManager();
    const id = em.createEntity();

    em.getEntitiesWith('Transform');
    expect(em.getEntitiesWith('Transform')).toEqual([]);

    em.addComponent(id, new TransformComponent());
    expect(em.getEntitiesWith('Transform')).toEqual([id]);

    em.removeComponent(id, 'Transform');
    expect(em.getEntitiesWith('Transform')).toEqual([]);

    em.addComponent(id, new TransformComponent());
    em.destroyEntity(id);
    expect(em.getEntitiesWith('Transform')).toEqual([]);
  });

  it('removes empty cached views and indexes when an entity is destroyed', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(id, new MeshComponent());
    em.getEntitiesWith('Mesh', 'Transform');

    em.destroyEntity(id);

    expect((em as any).views.has('Mesh|Transform')).toBe(false);
    expect((em as any).viewKeysByComponentType.has('Mesh')).toBe(false);
    expect((em as any).viewKeysByComponentType.has('Transform')).toBe(false);
  });

  it('removes empty cached views and indexes when components no longer match', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(id, new MeshComponent());
    em.getEntitiesWith('Mesh', 'Transform');

    em.removeComponent(id, 'Mesh');

    expect((em as any).views.has('Mesh|Transform')).toBe(false);
    expect((em as any).viewKeysByComponentType.has('Mesh')).toBe(false);
    expect((em as any).viewKeysByComponentType.has('Transform')).toBe(false);
  });

  it('purges viewKeysByComponentType deterministically after 1000 add/remove cycles', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(id, new MeshComponent());
    em.getEntitiesWith('Mesh', 'Transform');

    for (let i = 0; i < 1000; i++) {
      em.removeComponent(id, 'Mesh');
      em.addComponent(id, new MeshComponent());
    }

    // After all cycles the last removeComponent left the view empty; the view
    // and both index entries must be fully cleaned up.
    em.removeComponent(id, 'Mesh');

    expect((em as any).views.has('Mesh|Transform')).toBe(false);
    expect((em as any).viewKeysByComponentType.has('Mesh')).toBe(false);
    expect((em as any).viewKeysByComponentType.has('Transform')).toBe(false);
    expect((em as any).viewKeysByComponentType.size).toBe(0);
  });

  it('ignores addComponent on non-existent entity', () => {
    const em = new EntityManager();
    em.addComponent(999, new TransformComponent());
    expect(em.hasComponent(999, 'Transform')).toBe(false);
  });

  it('does not trigger updateEntityInViews when updating an existing component type', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent(1, 2, 3));
    em.getEntitiesWith('Transform'); // register a view

    const spy = vi.spyOn(em as any, 'updateEntityInViews');
    em.addComponent(id, new TransformComponent(4, 5, 6));

    expect(spy).not.toHaveBeenCalled();
    expect((em.getComponent(id, 'Transform') as TransformComponent).x).toBe(4);
  });

  it('destroyEntity is a no-op for unknown ids', () => {
    const em = new EntityManager();
    expect(() => em.destroyEntity(42)).not.toThrow();
  });

  it('prunes empty component stores on destroyEntity', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.destroyEntity(id);

    expect((em as any).stores.has('Transform')).toBe(false);
  });

  it('destroyEntity only touches stores for components the entity owns', () => {
    const em = new EntityManager();

    // entity A owns only Transform
    const a = em.createEntity();
    em.addComponent(a, new TransformComponent());

    // entity B owns only Mesh – its store must survive after destroying A
    const b = em.createEntity();
    em.addComponent(b, new MeshComponent());

    em.destroyEntity(a);

    // A is gone and its store is pruned
    expect(em.hasEntity(a)).toBe(false);
    expect((em as any).stores.has('Transform')).toBe(false);

    // B is untouched
    expect(em.hasEntity(b)).toBe(true);
    expect((em as any).stores.has('Mesh')).toBe(true);
    expect(em.hasComponent(b, 'Mesh')).toBe(true);
  });

  it('destroyEntity calls dispose() on each removed component', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const mesh = new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    em.addComponent(id, mesh);

    expect(mesh.vertices.length).toBe(9);

    em.destroyEntity(id);

    // dispose() should have cleared the typed-array references
    expect(mesh.vertices.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
    expect(mesh.normals.length).toBe(0);
    expect(mesh.uvs.length).toBe(0);
  });

  it('destroyEntity does not throw when components have no dispose() method', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());

    // TransformComponent does not implement dispose() – must not throw
    expect(() => em.destroyEntity(id)).not.toThrow();
  });

  it('destroyEntity does not dispose a shared MeshComponent while another entity still holds it', () => {
    const em = new EntityManager();
    const sharedVertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const mesh = new MeshComponent(sharedVertices);

    const a = em.createEntity();
    const b = em.createEntity();
    em.addComponent(a, mesh);
    em.addComponent(b, mesh);

    // Destroy only entity A – entity B still owns the same instance
    em.destroyEntity(a);

    expect(em.hasEntity(b)).toBe(true);
    expect(em.hasComponent(b, 'Mesh')).toBe(true);
    // The shared instance must NOT have been disposed
    expect(mesh.vertices.length).toBe(sharedVertices.length);

    // Destroying the last entity that holds the instance must dispose it
    em.destroyEntity(b);
    expect(mesh.vertices.length).toBe(0);
  });

  it('removeComponent calls dispose() when the component is no longer shared', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const mesh = new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    em.addComponent(id, mesh);

    em.removeComponent(id, 'Mesh');

    expect(mesh.vertices.length).toBe(0);
  });

  it('removeComponent does not dispose a shared MeshComponent while another entity still holds it', () => {
    const em = new EntityManager();
    const sharedVertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const mesh = new MeshComponent(sharedVertices);

    const a = em.createEntity();
    const b = em.createEntity();
    em.addComponent(a, mesh);
    em.addComponent(b, mesh);

    // Remove the Mesh from entity A only
    em.removeComponent(a, 'Mesh');

    // Entity B still holds the instance – must not have been disposed
    expect(em.hasComponent(b, 'Mesh')).toBe(true);
    expect(mesh.vertices.length).toBe(sharedVertices.length);
  });

  it('destroys 1000 entities and leaves no stale component data in stores or signatures', () => {
    const em = new EntityManager();
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

    // Register a view before creating entities so view-cleanup is exercised
    em.getEntitiesWith('Transform', 'Mesh');

    for (let i = 0; i < 1000; i++) {
      const id = em.createEntity();
      em.addComponent(id, new TransformComponent(i, 0, 0));
      em.addComponent(id, new MeshComponent(vertices));
    }

    expect(em.getEntitiesWith('Transform', 'Mesh')).toHaveLength(1000);

    // Capture IDs before destroying
    const ids = em.getEntitiesWith('Transform', 'Mesh');
    for (const id of ids) {
      em.destroyEntity(id);
    }

    expect(em.getEntitiesWith('Transform', 'Mesh')).toHaveLength(0);
    expect((em as any).stores.size).toBe(0);
    expect((em as any).signatures.size).toBe(0);
    expect((em as any).entities.size).toBe(0);
    expect((em as any).freeIds.length).toBe(1000);
  });

  it('supports more than 31 distinct component types', () => {
    const em = new EntityManager();
    const id = em.createEntity();

    for (let i = 0; i < 32; i++) {
      em.addComponent(id, { type: `Component${i}` });
    }

    expect(em.getEntitiesWith('Component0', 'Component31')).toEqual([id]);
  });

  it('reuses destroyed entity ids instead of allocating new ones', () => {
    const em = new EntityManager();
    const a = em.createEntity(); // id 0
    const b = em.createEntity(); // id 1
    em.destroyEntity(a);
    const c = em.createEntity(); // should reuse id 0
    expect(c).toBe(a);
    expect(em.hasEntity(b)).toBe(true);
    expect(em.hasEntity(c)).toBe(true);
  });

  it('reused ids start with an empty signature and no stale components', () => {
    const em = new EntityManager();
    const a = em.createEntity();
    em.addComponent(a, new TransformComponent(1, 2, 3));
    em.destroyEntity(a);

    const b = em.createEntity(); // reuses a's id
    expect(b).toBe(a);
    expect(em.hasComponent(b, 'Transform')).toBe(false);
    em.addComponent(b, new TransformComponent(7, 8, 9));
    expect(em.getComponent<TransformComponent>(b, 'Transform')?.x).toBe(7);
  });

  it('does not exceed nextId when ids are continuously recycled', () => {
    const em = new EntityManager();
    const id = em.createEntity(); // nextId becomes 1
    for (let i = 0; i < 1000; i++) {
      em.destroyEntity(id);
      em.createEntity(); // reuses id, nextId stays 1
    }
    expect((em as any).nextId).toBe(1);
  });

  it('clearEmptyViews removes views with zero entities', () => {
    const em = new EntityManager();

    // Query with a type that no entity owns – view is cached but empty
    em.getEntitiesWith('Phantom');
    expect((em as any).views.has('Phantom')).toBe(true);

    em.clearEmptyViews();

    expect((em as any).views.has('Phantom')).toBe(false);
    expect((em as any).viewKeysByComponentType.has('Phantom')).toBe(false);
  });

  it('clearEmptyViews does not remove views that have at least one entity', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.getEntitiesWith('Transform');

    em.clearEmptyViews();

    expect((em as any).views.has('Transform')).toBe(true);
    expect(em.getEntitiesWith('Transform')).toEqual([id]);
  });

  it('clearEmptyViews prevents unbounded cache growth from one-off queries', () => {
    const em = new EntityManager();

    for (let i = 0; i < 100; i++) {
      em.getEntitiesWith(`UniqueComponent_${i}`);
    }
    expect((em as any).views.size).toBe(100);

    em.clearEmptyViews();

    expect((em as any).views.size).toBe(0);
    expect((em as any).viewKeysByComponentType.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// forEachEntityWith
// ---------------------------------------------------------------------------

describe('EntityManager.forEachEntityWith', () => {
  it('visits all matching entities and none of the non-matching ones', () => {
    const em = new EntityManager();
    const a = em.createEntity();
    const b = em.createEntity();
    const c = em.createEntity();

    em.addComponent(a, new TransformComponent());
    em.addComponent(a, new MeshComponent());
    em.addComponent(b, new TransformComponent());
    em.addComponent(c, new MeshComponent());

    const visited: number[] = [];
    em.forEachEntityWith(['Transform', 'Mesh'], (id) => visited.push(id));

    expect(visited).toEqual([a]);
  });

  it('never invokes the callback when no entities match', () => {
    const em = new EntityManager();
    em.createEntity(); // no components

    const visited: number[] = [];
    em.forEachEntityWith(['Transform'], (id) => visited.push(id));

    expect(visited).toHaveLength(0);
  });

  it('shares the cached view with getEntitiesWith for the same component set', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(id, new MeshComponent());

    em.forEachEntityWith(['Transform', 'Mesh'], () => {});
    em.getEntitiesWith('Transform', 'Mesh');

    // Both calls should resolve to the same view key — only one entry in the cache
    expect((em as any).views.size).toBe(1);
  });

  it('keeps the callback-visited set in sync after components change', () => {
    const em = new EntityManager();
    const id = em.createEntity();

    em.forEachEntityWith(['Transform'], () => {}); // populate cache

    em.addComponent(id, new TransformComponent());
    const first: number[] = [];
    em.forEachEntityWith(['Transform'], (i) => first.push(i));
    expect(first).toEqual([id]);

    em.removeComponent(id, 'Transform');
    const second: number[] = [];
    em.forEachEntityWith(['Transform'], (i) => second.push(i));
    expect(second).toHaveLength(0);
  });

  it('accepts a readonly string[] (e.g. from requiredComponents as const)', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());

    const types = ['Transform'] as const;
    const visited: number[] = [];
    em.forEachEntityWith(types, (i) => visited.push(i));

    expect(visited).toEqual([id]);
  });
});

describe('System.safeUpdate', () => {
  it('does not rethrow errors thrown by update()', () => {
    class FailingSystem extends System {
      readonly requiredComponents = [] as const;
      update(): void { throw new Error('boom'); }
    }
    const em = new EntityManager();
    expect(() => new FailingSystem().safeUpdate(em, 0.016)).not.toThrow();
  });

  it('logs the caught error via console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    class FailingSystem extends System {
      readonly requiredComponents = [] as const;
      update(): void { throw new Error('boom'); }
    }
    const em = new EntityManager();
    new FailingSystem().safeUpdate(em, 0.016);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('invokes update() normally when no error is thrown', () => {
    let called = false;
    class WorkingSystem extends System {
      readonly requiredComponents = [] as const;
      update(): void { called = true; }
    }
    const em = new EntityManager();
    new WorkingSystem().safeUpdate(em, 0.016);
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

describe('TransformComponent', () => {
  it('has correct default values', () => {
    const t = new TransformComponent();
    expect(t.type).toBe('Transform');
    expect(t.x).toBe(0);
    expect(t.scaleX).toBe(1);
  });

  it('rotation defaults to the identity quaternion', () => {
    const t = new TransformComponent();
    expect(t.rotation).toEqual([0, 0, 0, 1]);
  });

  it('accepts a custom quaternion in the constructor', () => {
    const q: [number, number, number, number] = [0.1, 0.2, 0.3, 0.9];
    const t = new TransformComponent(0, 0, 0, q);
    expect(t.rotation).toEqual([0.1, 0.2, 0.3, 0.9]);
  });

  it('needsModelMatrixUpdate detects changes to rotation quaternion components', () => {
    const t = new TransformComponent();
    t.markModelMatrixClean();
    expect(t.needsModelMatrixUpdate()).toBe(false);
    t.rotation[1] = 0.5; // mutate Y component
    expect(t.needsModelMatrixUpdate()).toBe(true);
  });

  it('needsModelMatrixUpdate returns true initially', () => {
    const t = new TransformComponent();
    expect(t.needsModelMatrixUpdate()).toBe(true);
  });

  it('needsModelMatrixUpdate returns false after markModelMatrixClean', () => {
    const t = new TransformComponent();
    t.markModelMatrixClean();
    expect(t.needsModelMatrixUpdate()).toBe(false);
  });

  it('setDirty forces needsModelMatrixUpdate to return true even when values are unchanged', () => {
    const t = new TransformComponent();
    t.markModelMatrixClean();
    expect(t.needsModelMatrixUpdate()).toBe(false);
    t.setDirty();
    expect(t.needsModelMatrixUpdate()).toBe(true);
  });

  it('setDirty works after component is recycled with identical values', () => {
    // Simulate recycling: component cleaned, then reinitialized to the same values
    const t = new TransformComponent(5, 5, 5);
    t.markModelMatrixClean();
    expect(t.needsModelMatrixUpdate()).toBe(false);

    // External script reassigns to same values – change detection would miss this
    t.x = 5;
    t.y = 5;
    t.z = 5;
    expect(t.needsModelMatrixUpdate()).toBe(false);

    // setDirty forces an update
    t.setDirty();
    expect(t.needsModelMatrixUpdate()).toBe(true);
  });

  it('markModelMatrixClean clears dirty flag set by setDirty', () => {
    const t = new TransformComponent();
    t.markModelMatrixClean();
    t.setDirty();
    expect(t.needsModelMatrixUpdate()).toBe(true);
    t.markModelMatrixClean();
    expect(t.needsModelMatrixUpdate()).toBe(false);
  });
});

describe('MeshComponent', () => {
  it('has correct default values', () => {
    const m = new MeshComponent();
    expect(m.type).toBe('Mesh');
    expect(m.vertices.length).toBe(0);
  });

  it('reuses shared empty typed arrays for defaults', () => {
    const a = new MeshComponent();
    const b = new MeshComponent();

    expect(a.vertices).toBe(b.vertices);
    expect(a.indices).toBe(b.indices);
    expect(a.normals).toBe(b.normals);
    expect(a.uvs).toBe(b.uvs);
  });
});

// ---------------------------------------------------------------------------
// RenderSystem
// ---------------------------------------------------------------------------

describe('RenderSystem', () => {
  function createMockGL(): WebGL2RenderingContext {
    return {
      ARRAY_BUFFER: 0x8892,
      ELEMENT_ARRAY_BUFFER: 0x8893,
      STATIC_DRAW: 0x88E4,
      FLOAT: 0x1406,
      TRIANGLES: 0x0004,
      UNSIGNED_SHORT: 0x1403,
      UNSIGNED_INT: 0x1405,
      UNSIGNED_BYTE: 0x1401,
      createVertexArray: vi.fn(() => ({} as WebGLVertexArrayObject)),
      createBuffer: vi.fn(() => ({} as WebGLBuffer)),
      bindVertexArray: vi.fn(),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      drawArrays: vi.fn(),
      drawElements: vi.fn(),
      deleteBuffer: vi.fn(),
      deleteVertexArray: vi.fn(),
    } as unknown as WebGL2RenderingContext;
  }

  function createMockMaterial() {
    return { use: vi.fn(), setVec4: vi.fn(), setMat4: vi.fn() };
  }

  function createRenderSystemWithMocks(
    onMeshBufferAllocationFailure?: (message: string) => void,
    isContextLost = false,
  ) {
    const gl = createMockGL();
    const material = createMockMaterial();
    const renderer = { gl, isContextLost };
    const sys = new RenderSystem(renderer as any, material as any, onMeshBufferAllocationFailure);
    return { gl, material, renderer, sys };
  }

  it('declares required components', () => {
    const sys = new RenderSystem();
    expect(sys.requiredComponents).toEqual(['Transform', 'Mesh']);
  });

  it('update runs without errors', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent(1, 2, 3));
    em.addComponent(id, new MeshComponent(new Float32Array([0, 0, 0])));

    const sys = new RenderSystem();
    expect(() => sys.update(em, 0.016)).not.toThrow();
  });

  it('issues drawArrays for non-indexed meshes', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );

    const { gl, material, sys } = createRenderSystemWithMocks();

    sys.update(em, 0.016);

    expect(material.use).toHaveBeenCalled();
    expect(material.setMat4).toHaveBeenCalledWith('u_model', expect.any(Float32Array));
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3);
  });

  it('computes the correct model matrix from a quaternion rotation', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const q = quat.fromEuler(quat.create(), 23, -40, 63, 'xyz');
    const rotation: [number, number, number, number] = [q[0], q[1], q[2], q[3]];
    em.addComponent(id, new TransformComponent(1, -2, 3, rotation, 2, 3, 4));
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );

    const { material, sys } = createRenderSystemWithMocks();
    sys.update(em, 0.016);

    const modelCall = material.setMat4.mock.calls.find(
      (call) => call[0] === 'u_model',
    );
    expect(modelCall).toBeDefined();

    const expectedModel = mat4.create();
    mat4.fromRotationTranslationScale(
      expectedModel,
      q,
      vec3.fromValues(1, -2, 3),
      vec3.fromValues(2, 3, 4),
    );

    const modelMatrix = modelCall?.[1];
    expect(modelMatrix).toBeInstanceOf(Float32Array);
    for (let i = 0; i < expectedModel.length; i++) {
      expect(modelMatrix?.[i]).toBeCloseTo(expectedModel[i], 6);
    }
  });

  it('does not recompute model matrix for unchanged transforms', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent(1, 2, 3, [0, 0, 0, 1], 2, 2, 2));
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );
    const fromRotationTranslationScaleSpy = vi.spyOn(mat4, 'fromRotationTranslationScale');
    const { sys } = createRenderSystemWithMocks();

    sys.update(em, 0.016);
    sys.update(em, 0.016);

    expect(fromRotationTranslationScaleSpy).toHaveBeenCalledTimes(1);
    fromRotationTranslationScaleSpy.mockRestore();
  });

  it('recomputes model matrix when transform changes', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const transform = new TransformComponent();
    em.addComponent(id, transform);
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );
    const fromRotationTranslationScaleSpy = vi.spyOn(mat4, 'fromRotationTranslationScale');
    const { sys } = createRenderSystemWithMocks();

    sys.update(em, 0.016);
    transform.x = 1;
    sys.update(em, 0.016);

    expect(fromRotationTranslationScaleSpy).toHaveBeenCalledTimes(2);
    fromRotationTranslationScaleSpy.mockRestore();
  });

  it('issues drawElements for indexed meshes', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Uint16Array([0, 1, 2]),
      ),
    );

    const { gl, sys } = createRenderSystemWithMocks();

    sys.update(em, 0.016);

    expect(gl.drawElements).toHaveBeenCalledWith(
      gl.TRIANGLES,
      3,
      gl.UNSIGNED_SHORT,
      0,
    );
  });

  it('issues drawElements with UNSIGNED_INT for Uint32 indices', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Uint32Array([0, 1, 70000]),
      ),
    );

    const { gl, sys } = createRenderSystemWithMocks();

    sys.update(em, 0.016);

    expect(gl.drawElements).toHaveBeenCalledWith(
      gl.TRIANGLES,
      3,
      gl.UNSIGNED_INT,
      0,
    );
  });

  it('issues drawElements with UNSIGNED_BYTE for Uint8 indices', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Uint8Array([0, 1, 2]),
      ),
    );

    const { gl, sys } = createRenderSystemWithMocks();

    sys.update(em, 0.016);

    expect(gl.drawElements).toHaveBeenCalledWith(
      gl.TRIANGLES,
      3,
      gl.UNSIGNED_BYTE,
      0,
    );
  });

  it('binds normal and uv attributes when provided', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Uint16Array([0, 1, 2]),
        new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        new Float32Array([0, 0, 1, 0, 0, 1]),
      ),
    );

    const { gl, sys } = createRenderSystemWithMocks();

    sys.update(em, 0.016);

    expect(gl.enableVertexAttribArray).toHaveBeenCalledWith(1);
    expect(gl.enableVertexAttribArray).toHaveBeenCalledWith(2);
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(1, 3, gl.FLOAT, false, 0, 0);
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(2, 2, gl.FLOAT, false, 0, 0);
  });

  it('releases GPU mesh buffers when Mesh component is removed', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Uint16Array([0, 1, 2]),
      ),
    );

    const { gl, sys } = createRenderSystemWithMocks();
    sys.update(em, 0.016);

    em.removeComponent(id, 'Mesh');
    sys.update(em, 0.016);

    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
  });

  it('releases optional GPU buffers for normals and uvs', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Uint16Array([0, 1, 2]),
        new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        new Float32Array([0, 0, 1, 0, 0, 1]),
      ),
    );

    const { gl, sys } = createRenderSystemWithMocks();
    sys.update(em, 0.016);

    em.removeComponent(id, 'Mesh');
    sys.update(em, 0.016);

    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(4);
  });

  it('releases GPU mesh buffers when entity is destroyed', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );

    const { gl, sys } = createRenderSystemWithMocks();
    sys.update(em, 0.016);

    em.destroyEntity(id);
    sys.update(em, 0.016);

    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
  });

  it('flushStaleMeshBuffers releases GPU buffers outside the update loop', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );

    const { gl, sys } = createRenderSystemWithMocks();
    sys.update(em, 0.016);

    em.destroyEntity(id);
    // intentionally do NOT call sys.update – simulate a paused animation loop
    sys.flushStaleMeshBuffers(em);

    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
  });

  it('flushStaleMeshBuffers is a no-op when no renderer is present', () => {
    const em = new EntityManager();
    const sys = new RenderSystem();
    expect(() => sys.flushStaleMeshBuffers(em)).not.toThrow();
  });

  it('flushStaleMeshBuffers is a no-op when mesh buffers are empty', () => {
    const em = new EntityManager();
    const { gl, sys } = createRenderSystemWithMocks();
    sys.flushStaleMeshBuffers(em);
    expect(gl.deleteVertexArray).not.toHaveBeenCalled();
    expect(gl.deleteBuffer).not.toHaveBeenCalled();
  });

  it('flushStaleMeshBuffers preserves buffers for still-active entities', () => {
    const em = new EntityManager();
    const id1 = em.createEntity();
    em.addComponent(id1, new TransformComponent());
    em.addComponent(
      id1,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );
    const id2 = em.createEntity();
    em.addComponent(id2, new TransformComponent());
    em.addComponent(
      id2,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );

    const { gl, sys } = createRenderSystemWithMocks();
    sys.update(em, 0.016);

    em.destroyEntity(id1);
    sys.flushStaleMeshBuffers(em);

    // only the destroyed entity's buffers should be freed
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
  });

  it('calls allocation failure handler once when failures are consecutive', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(id, new MeshComponent(new Float32Array([0, 0, 0])));

    const onFailure = vi.fn();
    const { gl, sys } = createRenderSystemWithMocks(onFailure);
    vi.mocked(gl.createVertexArray).mockReturnValue(null as unknown as WebGLVertexArrayObject);

    sys.update(em, 0.016);
    expect(onFailure).not.toHaveBeenCalled();
    sys.update(em, 0.016);
    sys.update(em, 0.016);

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('resets consecutive allocation failures after a successful allocation', () => {
    const em = new EntityManager();
    const id1 = em.createEntity();
    em.addComponent(id1, new TransformComponent());
    em.addComponent(id1, new MeshComponent(new Float32Array([0, 0, 0])));
    const id2 = em.createEntity();
    em.addComponent(id2, new TransformComponent());
    em.addComponent(id2, new MeshComponent(new Float32Array([0, 0, 0])));

    const onFailure = vi.fn();
    const { gl, sys } = createRenderSystemWithMocks(onFailure);
    vi.mocked(gl.createVertexArray)
      .mockReturnValueOnce(null as unknown as WebGLVertexArrayObject)
      .mockReturnValueOnce({} as WebGLVertexArrayObject)
      .mockReturnValueOnce(null as unknown as WebGLVertexArrayObject)
      .mockReturnValueOnce(null as unknown as WebGLVertexArrayObject);

    sys.update(em, 0.016);
    sys.update(em, 0.016);
    expect(onFailure).not.toHaveBeenCalled();
    sys.update(em, 0.016);

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('ensureMeshBuffers returns null and skips draw calls during context loss', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array([0, 1, 2])),
    );

    const { gl, sys } = createRenderSystemWithMocks(undefined, true);
    sys.update(em, 0.016);

    // No buffers should have been allocated and no draw calls issued
    expect(gl.createVertexArray).not.toHaveBeenCalled();
    expect(gl.createBuffer).not.toHaveBeenCalled();
    expect(gl.drawArrays).not.toHaveBeenCalled();
    expect(gl.drawElements).not.toHaveBeenCalled();
  });

  it('render loop resumes normally after context is restored', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );

    const { gl, renderer, sys } = createRenderSystemWithMocks(undefined, true);

    // Update during context loss — no draw calls expected
    sys.update(em, 0.016);
    expect(gl.drawArrays).not.toHaveBeenCalled();

    // Simulate context restoration
    renderer.isContextLost = false;
    sys.resetGpuResources();
    sys.update(em, 0.016);

    expect(gl.createVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
  });

  it('resetGpuResources does not call gl.delete* (context-loss safe)', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array([0, 1, 2])),
    );

    const { gl, sys } = createRenderSystemWithMocks();
    sys.update(em, 0.016);

    // Simulate context loss: reset GPU resources without calling delete*
    sys.resetGpuResources();

    expect(gl.deleteBuffer).not.toHaveBeenCalled();
    expect(gl.deleteVertexArray).not.toHaveBeenCalled();
  });

  it('resetGpuResources clears the buffer cache so it is rebuilt on next draw', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent());
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );

    const { gl, sys } = createRenderSystemWithMocks();
    sys.update(em, 0.016);

    // First draw allocated one VAO and one VBO
    expect(gl.createVertexArray).toHaveBeenCalledTimes(1);

    sys.resetGpuResources();

    // After reset the cache is empty, so the next draw must reallocate
    sys.update(em, 0.016);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// CameraComponent
// ---------------------------------------------------------------------------

describe('CameraComponent', () => {
  it('has correct default values', () => {
    const c = new CameraComponent();
    expect(c.type).toBe('Camera');
    expect(c.fov).toBeCloseTo(Math.PI / 4);
    expect(c.near).toBe(0.1);
    expect(c.far).toBe(100);
    expect(c.radius).toBe(5);
    expect(c.theta).toBe(0);
    expect(c.phi).toBeCloseTo(Math.PI / 4);
    expect(c.target).toEqual([0, 0, 0]);
  });

  it('accepts custom parameters', () => {
    const c = new CameraComponent(Math.PI / 3, 0.5, 200, 10, 1.0, 0.5, [1, 2, 3]);
    expect(c.fov).toBeCloseTo(Math.PI / 3);
    expect(c.near).toBe(0.5);
    expect(c.far).toBe(200);
    expect(c.radius).toBe(10);
    expect(c.theta).toBe(1.0);
    expect(c.phi).toBe(0.5);
    expect(c.target).toEqual([1, 2, 3]);
  });

  it('initializes identity matrices', () => {
    const c = new CameraComponent();
    // gl-matrix mat4.create() returns an identity matrix
    expect(c.projection[0]).toBe(1);
    expect(c.projection[5]).toBe(1);
    expect(c.view[0]).toBe(1);
    expect(c.view[5]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// OrbitalCameraSystem
// ---------------------------------------------------------------------------

describe('OrbitalCameraSystem', () => {
  beforeEach(() => {
    (globalThis as any).window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  });
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('declares required components', () => {
    const sys = new OrbitalCameraSystem();
    expect(sys.requiredComponents).toEqual(['Camera']);
  });

  it('update computes view and projection matrices', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const cam = new CameraComponent();
    em.addComponent(id, cam);

    const sys = new OrbitalCameraSystem();
    sys.update(em, 0.016);

    // After update the matrices should no longer be identity
    // (phi=PI/4 means eye is above the target)
    expect(cam.view[12]).not.toBe(0); // translation component of lookAt
  });

  it('uses drawing buffer size for projection aspect ratio', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new CameraComponent());

    const canvas = {
      width: 400,
      height: 200,
      clientWidth: 100,
      clientHeight: 100,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    const sys = new OrbitalCameraSystem();
    const perspectiveSpy = vi.spyOn(mat4, 'perspective');
    sys.attach(canvas);
    sys.update(em, 0.016);

    expect(perspectiveSpy).toHaveBeenCalled();
    expect(perspectiveSpy.mock.calls[0][2]).toBeCloseTo(2);
    perspectiveSpy.mockRestore();
  });

  it('does not rebuild matrices when there is no input and canvas size is unchanged', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new CameraComponent());

    const sys = new OrbitalCameraSystem();
    const lookAtSpy = vi.spyOn(mat4, 'lookAt');
    const perspectiveSpy = vi.spyOn(mat4, 'perspective');

    sys.update(em, 0.016);
    sys.update(em, 0.016);

    expect(lookAtSpy).toHaveBeenCalledTimes(1);
    expect(perspectiveSpy).toHaveBeenCalledTimes(1);
    lookAtSpy.mockRestore();
    perspectiveSpy.mockRestore();
  });

  it('does not rebuild projection when canvas is resized proportionally', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new CameraComponent());

    const canvas = {
      width: 800,
      height: 600,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    const sys = new OrbitalCameraSystem();
    sys.attach(canvas);
    sys.update(em, 0.016);

    const perspectiveSpy = vi.spyOn(mat4, 'perspective');

    // Proportional resize: same aspect ratio (4:3), different dimensions
    (canvas as any).width = 1600;
    (canvas as any).height = 1200;
    sys.update(em, 0.016);

    expect(perspectiveSpy).not.toHaveBeenCalled();
    perspectiveSpy.mockRestore();
  });

  it('clamps phi to avoid poles', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const cam = new CameraComponent();
    cam.phi = -1; // way below minimum
    em.addComponent(id, cam);

    const sys = new OrbitalCameraSystem();
    sys.update(em, 0.016);

    // phi must stay within (0, π) and be at least (90 - sys.maxElevationDeg)°
    // away from both poles (0 and π); with the default of 89.9°, this is 0.1°.
    const phiMin = (90 - sys.maxElevationDeg) * (Math.PI / 180);
    expect(cam.phi).toBeGreaterThanOrEqual(phiMin);
    expect(cam.phi).toBeLessThanOrEqual(Math.PI - phiMin);
  });

  it('clamps radius within bounds', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const cam = new CameraComponent();
    cam.radius = 0.01; // below default minRadius of 0.5
    em.addComponent(id, cam);

    const sys = new OrbitalCameraSystem();
    sys.update(em, 0.016);

    expect(cam.radius).toBe(0.5);
  });

  it('update runs without errors on empty entity set', () => {
    const em = new EntityManager();
    const sys = new OrbitalCameraSystem();
    expect(() => sys.update(em, 0.016)).not.toThrow();
  });

  it('update does not allocate vec3 with fromValues each frame', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new CameraComponent());

    const spy = vi.spyOn(vec3, 'fromValues');
    const sys = new OrbitalCameraSystem();
    sys.update(em, 0.016);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('applies touch drag input to orbital angles', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const cam = new CameraComponent();
    cam.phi = 2;
    em.addComponent(id, cam);

    const canvasListeners = new Map<string, EventListener>();
    const windowListeners = new Map<string, EventListener>();
    const canvas = {
      width: 100,
      height: 100,
      clientWidth: 100,
      clientHeight: 100,
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        canvasListeners.set(type, handler);
      }),
      removeEventListener: vi.fn((type: string) => {
        canvasListeners.delete(type);
      }),
    } as unknown as HTMLCanvasElement;

    (globalThis as any).window.addEventListener = vi.fn(
      (type: string, handler: EventListener) => {
        windowListeners.set(type, handler);
      },
    );

    const sys = new OrbitalCameraSystem();
    sys.rotateSensitivity = 0.1;
    sys.attach(canvas);

    const start = canvasListeners.get('touchstart');
    const move = canvasListeners.get('touchmove');
    const end = windowListeners.get('touchend');
    expect(start).toBeDefined();
    expect(move).toBeDefined();
    expect(end).toBeDefined();

    start?.({
      touches: [{ clientX: 10, clientY: 20 }],
    } as unknown as Event);
    const preventDefault = vi.fn();
    move?.({
      touches: [{ clientX: 12, clientY: 23 }],
      preventDefault,
    } as unknown as Event);
    end?.({} as Event);

    sys.update(em, 0.016);
    expect(preventDefault).toHaveBeenCalled();
    expect(cam.theta).toBeCloseTo(-0.2);
    expect(cam.phi).toBeCloseTo(1.7);
  });

  it('detaches touchmove and wheel listeners with passive false options', () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    const sys = new OrbitalCameraSystem();
    sys.attach(canvas);
    sys.detach();

    const touchMoveHandler = (canvas.addEventListener as any).mock.calls.find(
      (call: unknown[]) => call[0] === 'touchmove',
    )?.[1];
    const wheelHandler = (canvas.addEventListener as any).mock.calls.find(
      (call: unknown[]) => call[0] === 'wheel',
    )?.[1];

    expect(canvas.removeEventListener).toHaveBeenCalledWith('touchmove', touchMoveHandler, {
      passive: false,
    });
    expect(canvas.removeEventListener).toHaveBeenCalledWith('wheel', wheelHandler, {
      passive: false,
    });
  });

  it('attaches touchstart and touchend listeners with passive true options', () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    const windowAddCalls: unknown[][] = [];
    (globalThis as any).window.addEventListener = vi.fn((...args: unknown[]) => {
      windowAddCalls.push(args);
    });

    const sys = new OrbitalCameraSystem();
    sys.attach(canvas);

    const touchStartHandler = (canvas.addEventListener as any).mock.calls.find(
      (call: unknown[]) => call[0] === 'touchstart',
    )?.[1];
    const touchEndCall = windowAddCalls.find((call) => call[0] === 'touchend');

    expect(canvas.addEventListener).toHaveBeenCalledWith('touchstart', touchStartHandler, {
      passive: true,
    });
    expect(touchEndCall).toBeDefined();
    expect(touchEndCall?.[2]).toEqual({ passive: true });
  });

  it('mouseup on window resets dragging state even when released outside canvas', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const cam = new CameraComponent();
    em.addComponent(id, cam);

    const canvasListeners = new Map<string, EventListener>();
    const windowListeners = new Map<string, EventListener>();
    const canvas = {
      width: 100,
      height: 100,
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        canvasListeners.set(type, handler);
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    (globalThis as any).window.addEventListener = vi.fn(
      (type: string, handler: EventListener) => {
        windowListeners.set(type, handler);
      },
    );

    const sys = new OrbitalCameraSystem();
    sys.rotateSensitivity = 0.1;
    sys.attach(canvas);

    const mousedown = canvasListeners.get('mousedown');
    const mousemove = canvasListeners.get('mousemove');
    const mouseup = windowListeners.get('mouseup');
    expect(mouseup).toBeDefined();

    // Start drag
    mousedown?.({ button: 0, clientX: 0, clientY: 0 } as unknown as Event);
    // Move a bit
    mousemove?.({ clientX: 5, clientY: 0 } as unknown as Event);
    // Release on window (outside canvas)
    mouseup?.({ button: 0 } as unknown as Event);
    // Move again – should have no effect since dragging is false
    mousemove?.({ clientX: 10, clientY: 0 } as unknown as Event);

    sys.update(em, 0.016);
    // Only the first move (5px) should have been applied
    expect(cam.theta).toBeCloseTo(-0.5);
  });

  it('touchend on window resets dragging state even when released outside canvas', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const cam = new CameraComponent();
    em.addComponent(id, cam);

    const canvasListeners = new Map<string, EventListener>();
    const windowListeners = new Map<string, EventListener>();
    const canvas = {
      width: 100,
      height: 100,
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        canvasListeners.set(type, handler);
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    (globalThis as any).window.addEventListener = vi.fn(
      (type: string, handler: EventListener) => {
        windowListeners.set(type, handler);
      },
    );

    const sys = new OrbitalCameraSystem();
    sys.rotateSensitivity = 0.1;
    sys.attach(canvas);

    const touchstart = canvasListeners.get('touchstart');
    const touchmove = canvasListeners.get('touchmove');
    const touchend = windowListeners.get('touchend');
    expect(touchend).toBeDefined();

    // Start drag
    touchstart?.({ touches: [{ clientX: 0, clientY: 0 }] } as unknown as Event);
    // Move a bit
    const preventDefault = vi.fn();
    touchmove?.({ touches: [{ clientX: 5, clientY: 0 }], preventDefault } as unknown as Event);
    // Release on window (outside canvas)
    touchend?.({} as Event);
    // Move again – should have no effect since dragging is false
    touchmove?.({ touches: [{ clientX: 10, clientY: 0 }], preventDefault } as unknown as Event);

    sys.update(em, 0.016);
    // Only the first move (5px) should have been applied
    expect(cam.theta).toBeCloseTo(-0.5);
  });

  it('detaches mouseup and touchend from window on detach', () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    const windowAddCalls: unknown[][] = [];
    const windowRemoveCalls: unknown[][] = [];
    (globalThis as any).window.addEventListener = vi.fn((...args: unknown[]) => {
      windowAddCalls.push(args);
    });
    (globalThis as any).window.removeEventListener = vi.fn((...args: unknown[]) => {
      windowRemoveCalls.push(args);
    });

    const sys = new OrbitalCameraSystem();
    sys.attach(canvas);
    sys.detach();

    const mouseupHandler = windowAddCalls.find((call) => call[0] === 'mouseup')?.[1];
    const touchendHandler = windowAddCalls.find((call) => call[0] === 'touchend')?.[1];

    expect(windowRemoveCalls).toContainEqual(['mouseup', mouseupHandler]);
    expect(windowRemoveCalls).toContainEqual(['touchend', touchendHandler, { passive: true }]);
  });

  it('normalizes wheel zoom across delta modes using fixed line/page constants', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const cam = new CameraComponent();
    em.addComponent(id, cam);

    const getComputedStyle = vi
      .fn()
      .mockReturnValue({ lineHeight: '24px', fontSize: '16px' } as CSSStyleDeclaration);
    const defaultView = { getComputedStyle, innerHeight: 900 } as unknown as Window;
    const ownerDocument = { defaultView, documentElement: {} as Element } as Document;
    const listeners = new Map<string, EventListener>();
    const canvas = {
      width: 960,
      height: 960,
      clientWidth: 960,
      clientHeight: 960,
      ownerDocument,
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, handler);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    } as unknown as HTMLCanvasElement;

    const sys = new OrbitalCameraSystem();
    sys.attach(canvas);
    const wheel = listeners.get('wheel');
    expect(wheel).toBeDefined();
    const startRadius = cam.radius;

    const preventDefault = vi.fn();
    // 48 raw pixels → (48 / 600) * 0.01
    wheel?.({ deltaY: 48, deltaMode: 0, preventDefault } as unknown as Event);
    sys.update(em, 0.016);
    const pixelStep = cam.radius - startRadius;

    // 3 lines × 16 px/line = 48 px → same step
    wheel?.({ deltaY: 3, deltaMode: 1, preventDefault } as unknown as Event);
    sys.update(em, 0.016);
    const lineStep = cam.radius - startRadius - pixelStep;

    // 0.08 pages × 600 px/page = 48 px → same step
    wheel?.({ deltaY: 0.08, deltaMode: 2, preventDefault } as unknown as Event);
    sys.update(em, 0.016);
    const pageStep = cam.radius - startRadius - pixelStep - lineStep;

    expect(preventDefault).toHaveBeenCalledTimes(3);
    // No DOM query needed — constants are now fixed
    expect(getComputedStyle).not.toHaveBeenCalled();
    expect(pixelStep).toBeCloseTo(lineStep);
    expect(lineStep).toBeCloseTo(pageStep);
    expect(pixelStep).toBeCloseTo(0.0008);
  });

  it('pagehide handler calls detach to remove all window listeners', () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    const windowListeners = new Map<string, EventListener>();
    (globalThis as any).window.addEventListener = vi.fn(
      (type: string, handler: EventListener) => {
        windowListeners.set(type, handler);
      },
    );
    (globalThis as any).window.removeEventListener = vi.fn();

    const sys = new OrbitalCameraSystem();
    sys.attach(canvas);

    // Register the same pagehide handler the demos use
    window.addEventListener('pagehide', () => { sys.detach(); }, { once: true });

    expect((globalThis as any).window.addEventListener).toHaveBeenCalledWith(
      'pagehide',
      expect.any(Function),
      { once: true },
    );

    // Invoke the captured pagehide handler to simulate the page being hidden
    const pagehideHandler = windowListeners.get('pagehide');
    expect(pagehideHandler).toBeDefined();
    pagehideHandler!(new Event('pagehide'));

    const mouseupHandler = windowListeners.get('mouseup');
    const touchendHandler = windowListeners.get('touchend');
    expect(mouseupHandler).toBeDefined();
    expect(touchendHandler).toBeDefined();

    expect((globalThis as any).window.removeEventListener).toHaveBeenCalledWith(
      'mouseup',
      mouseupHandler,
    );
    expect((globalThis as any).window.removeEventListener).toHaveBeenCalledWith(
      'touchend',
      touchendHandler,
      { passive: true },
    );
  });

  it('detach is a no-op when attach was never called', () => {
    const sys = new OrbitalCameraSystem();
    expect(() => sys.detach()).not.toThrow();
  });

  it('detach is a no-op when called a second time after detach', () => {
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    (globalThis as any).window.addEventListener = vi.fn();
    (globalThis as any).window.removeEventListener = vi.fn();

    const sys = new OrbitalCameraSystem();
    sys.attach(canvas);
    sys.detach();
    expect(() => sys.detach()).not.toThrow();
  });
});
