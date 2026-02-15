import { describe, it, expect, vi } from 'vitest';
import { EntityManager } from '../src/core/ecs/EntityManager';
import { TransformComponent } from '../src/core/ecs/components/TransformComponent';
import { MeshComponent } from '../src/core/ecs/components/MeshComponent';
import { CameraComponent } from '../src/core/ecs/components/CameraComponent';
import { RenderSystem } from '../src/core/ecs/systems/RenderSystem';
import { OrbitalCameraSystem } from '../src/core/ecs/systems/OrbitalCameraSystem';
import { vec3 } from 'gl-matrix';

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

  it('supports more than 31 distinct component types', () => {
    const em = new EntityManager();
    const id = em.createEntity();

    for (let i = 0; i < 32; i++) {
      em.addComponent(id, { type: `Component${i}` });
    }

    expect(em.getEntitiesWith('Component0', 'Component31')).toEqual([id]);
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
});

describe('MeshComponent', () => {
  it('has correct default values', () => {
    const m = new MeshComponent();
    expect(m.type).toBe('Mesh');
    expect(m.vertices.length).toBe(0);
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

  function createRenderSystemWithMocks() {
    const gl = createMockGL();
    const material = createMockMaterial();
    const renderer = { gl };
    const sys = new RenderSystem(renderer as any, material as any);
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

    const listeners = new Map<string, EventListener>();
    const canvas = {
      clientWidth: 100,
      clientHeight: 100,
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, handler);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    } as unknown as HTMLCanvasElement;

    const sys = new OrbitalCameraSystem();
    sys.rotateSensitivity = 0.1;
    sys.attach(canvas);

    const start = listeners.get('touchstart');
    const move = listeners.get('touchmove');
    const end = listeners.get('touchend');
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

  it('normalizes wheel zoom to direction only', () => {
    const em = new EntityManager();
    const id = em.createEntity();
    const cam = new CameraComponent();
    em.addComponent(id, cam);

    const listeners = new Map<string, EventListener>();
    const canvas = {
      clientWidth: 100,
      clientHeight: 100,
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
    wheel?.({ deltaY: 120, preventDefault } as unknown as Event);
    sys.update(em, 0.016);
    const radiusAfterLargeStep = cam.radius;

    wheel?.({ deltaY: 1, preventDefault } as unknown as Event);
    sys.update(em, 0.016);
    const radiusAfterSmallStep = cam.radius;

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(radiusAfterLargeStep).toBeCloseTo(startRadius + 0.01);
    expect(radiusAfterSmallStep).toBeCloseTo(startRadius + 0.02);
  });
});
