import { createDemoLayout } from '../demoLayout';
import { Material } from '../core/Material';
import { Renderer } from '../core/Renderer';
import { Time } from '../core/Time';
import {
  CameraComponent,
  EntityManager,
  MeshComponent,
  OrbitalCameraSystem,
  RenderSystem,
  TransformComponent,
} from '../core/ecs';

const GRID_RADIUS = 3;
const GRID_SPACING = 3;

function createCubeVertices(): Float32Array {
  return new Float32Array([
    -1, -1, 1, 1, -1, 1, 1, 1, 1,
    -1, -1, 1, 1, 1, 1, -1, 1, 1,
    -1, -1, -1, -1, 1, -1, 1, 1, -1,
    -1, -1, -1, 1, 1, -1, 1, -1, -1,
    -1, -1, -1, -1, -1, 1, -1, 1, 1,
    -1, -1, -1, -1, 1, 1, -1, 1, -1,
    1, -1, -1, 1, 1, -1, 1, 1, 1,
    1, -1, -1, 1, 1, 1, 1, -1, 1,
    -1, 1, -1, -1, 1, 1, 1, 1, 1,
    -1, 1, -1, 1, 1, 1, 1, 1, -1,
    -1, -1, -1, 1, -1, -1, 1, -1, 1,
    -1, -1, -1, 1, -1, 1, -1, -1, 1,
  ]);
}

export function runCameraDemo(): void {
  const layout = createDemoLayout('Orbital camera demo', [
    'Left click + drag: orbit',
    'Mouse wheel: zoom (radius clamped)',
  ]);
  const renderer = new Renderer(layout.canvasContainer);
  const time = new Time();
  const material = new Material(renderer.gl);
  const em = new EntityManager();
  const renderSystem = new RenderSystem(renderer, material);
  const cameraSystem = new OrbitalCameraSystem();
  cameraSystem.attach(renderer.canvas);
  renderer.onContextLost(() => {
    renderSystem.resetGpuResources();
  });
  renderer.onContextRestored((gl) => {
    material.restore(gl);
    renderSystem.resetGpuResources();
  });

  const camera = em.createEntity();
  em.addComponent(camera, new CameraComponent(Math.PI / 4, 0.1, 100, 18, 0.8, Math.PI / 3));

  const cubeVertices = createCubeVertices();
  for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
    for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
      const cube = em.createEntity();
      em.addComponent(cube, new TransformComponent(gx * GRID_SPACING, 0, gz * GRID_SPACING, 0, 0, 0, 0.7, 0.7, 0.7));
      em.addComponent(cube, new MeshComponent(cubeVertices));
    }
  }

  function loop(now: number): void {
    time.update(now);
    if (time.deltaTime > 0) {
      layout.fpsValue.textContent = (1 / time.deltaTime).toFixed(0);
    }
    renderer.clear(0.08, 0.08, 0.12, 1.0);
    cameraSystem.update(em, time.deltaTime);
    renderSystem.update(em, time.deltaTime);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
