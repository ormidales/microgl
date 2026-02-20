import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EntityManager } from '../src/core/ecs/EntityManager';
import { TransformComponent } from '../src/core/ecs/components/TransformComponent';
import { MeshComponent } from '../src/core/ecs/components/MeshComponent';
import { CameraComponent } from '../src/core/ecs/components/CameraComponent';
import { RenderSystem } from '../src/core/ecs/systems/RenderSystem';
import { OrbitalCameraSystem } from '../src/core/ecs/systems/OrbitalCameraSystem';
import { mat4, vec3 } from 'gl-matrix';

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
  ) {
    const gl = createMockGL();
    const material = createMockMaterial();
    const renderer = { gl };
    const sys = new RenderSystem(renderer as any, material as any, onMeshBufferAllocationFailure);
    return { gl, material, sys };
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

  it('computes the same model matrix as sequential TRS operations', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent(1, -2, 3, 0.4, -0.7, 1.1, 2, 3, 4));
    em.addComponent(
      id,
      new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array(0)),
    );

    const { material, sys } = createRenderSystemWithMocks();
    sys.update(em, 0.016);

    const modelCall = material.setMat4.mock.calls.find(
      (call: [string, Float32Array]) => call[0] === 'u_model',
    );
    expect(modelCall).toBeDefined();

    const expectedModel = mat4.create();
    mat4.translate(expectedModel, expectedModel, vec3.fromValues(1, -2, 3));
    mat4.rotateX(expectedModel, expectedModel, 0.4);
    mat4.rotateY(expectedModel, expectedModel, -0.7);
    mat4.rotateZ(expectedModel, expectedModel, 1.1);
    mat4.scale(expectedModel, expectedModel, vec3.fromValues(2, 3, 4));

    const modelMatrix = modelCall?.[1];
    expect(modelMatrix).toBeInstanceOf(Float32Array);
    for (let i = 0; i < expectedModel.length; i++) {
      expect(modelMatrix?.[i]).toBeCloseTo(expectedModel[i], 6);
    }
  });

  it('does not recompute model matrix for unchanged transforms', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    em.addComponent(id, new TransformComponent(1, 2, 3, 0.1, 0.2, 0.3, 2, 2, 2));
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
    vi.mocked(gl.createVertexArray).mockReturnValue(null);

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
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({} as WebGLVertexArrayObject)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    sys.update(em, 0.016);
    sys.update(em, 0.016);
    expect(onFailure).not.toHaveBeenCalled();
    sys.update(em, 0.016);

    expect(onFailure).toHaveBeenCalledTimes(1);
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

    expect(cam.phi).toBeGreaterThan(0);
    expect(cam.phi).toBeLessThan(Math.PI);
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
});
