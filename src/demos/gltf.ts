import { createDemoLayout } from '../demoLayout';
import { loadGltf } from '../core/GltfLoader';
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
import type { ParsedMesh } from '../core/GltfTypes';

const MODEL_URL = '/models/quad.glb';

function getMeshBounds(mesh: ParsedMesh): { min: [number, number, number]; max: [number, number, number] } {
  if (mesh.min.length >= 3 && mesh.max.length >= 3) {
    return {
      min: [mesh.min[0], mesh.min[1], mesh.min[2]],
      max: [mesh.max[0], mesh.max[1], mesh.max[2]],
    };
  }

  if (mesh.positions.length < 3) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }

  let minX = mesh.positions[0];
  let minY = mesh.positions[1];
  let minZ = mesh.positions[2];
  let maxX = mesh.positions[0];
  let maxY = mesh.positions[1];
  let maxZ = mesh.positions[2];

  for (let i = 3; i + 2 < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function getModelCenter(meshes: ParsedMesh[]): [number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const mesh of meshes) {
    const { min, max } = getMeshBounds(mesh);
    if (min[0] < minX) minX = min[0];
    if (min[1] < minY) minY = min[1];
    if (min[2] < minZ) minZ = min[2];
    if (max[0] > maxX) maxX = max[0];
    if (max[1] > maxY) maxY = max[1];
    if (max[2] > maxZ) maxZ = max[2];
  }

  if (!Number.isFinite(minX)) return [0, 0, 0];
  return [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
}

function getModelRadius(meshes: ParsedMesh[], center: [number, number, number]): number {
  let radius = 0;
  for (const mesh of meshes) {
    const { min, max } = getMeshBounds(mesh);
    const corners: [number, number, number][] = [
      [min[0], min[1], min[2]],
      [max[0], max[1], max[2]],
    ];
    for (const corner of corners) {
      const dx = corner[0] - center[0];
      const dy = corner[1] - center[1];
      const dz = corner[2] - center[2];
      radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  return radius > 0 ? radius : 1;
}

export function runGltfDemo(): void {
  const layout = createDemoLayout('glTF async loading demo', [
    'Left click + drag: orbit',
    'Mouse wheel: zoom',
    `Asset: ${MODEL_URL}`,
  ]);
  const renderer = new Renderer(layout.canvasContainer);
  const time = new Time();
  const material = new Material(renderer.gl);
  const em = new EntityManager();
  const renderSystem = new RenderSystem(renderer, material);
  const cameraSystem = new OrbitalCameraSystem();
  cameraSystem.attach(renderer.canvas);
  window.addEventListener('pagehide', () => { cameraSystem.detach(); }, { once: true });
  let renderLoopActive = true;
  renderer.onContextLost(() => {
    renderLoopActive = false;
    renderSystem.resetGpuResources();
  });
  renderer.onContextRestored((gl) => {
    material.restore(gl);
    renderSystem.resetGpuResources();
    renderLoopActive = true;
    requestAnimationFrame(loop);
  });

  const statusLabel = document.createElement('p');
  statusLabel.textContent = 'Status: ';
  const statusValue = document.createElement('output');
  statusValue.textContent = 'Loading...';
  statusLabel.append(statusValue);
  layout.performancePanel.append(statusLabel);

  const camera = em.createEntity();
  const cameraComponent = new CameraComponent();
  em.addComponent(camera, cameraComponent);

  const loadModel = async (): Promise<void> => {
    try {
      const response = await fetch(MODEL_URL);
      if (!response.ok) throw new Error(`Failed to fetch ${MODEL_URL}: ${response.status}`);
      const { meshes } = await loadGltf(await response.arrayBuffer());
      if (meshes.length === 0) throw new Error('No primitives found in glTF.');

      const center = getModelCenter(meshes);
      const radius = getModelRadius(meshes, center);
      cameraComponent.radius = Math.max(3, radius * 2.75);
      cameraComponent.target = [0, 0, 0];

      for (const mesh of meshes) {
        const entity = em.createEntity();
        em.addComponent(entity, new TransformComponent(-center[0], -center[1], -center[2]));
        em.addComponent(
          entity,
          new MeshComponent(mesh.positions, mesh.indices, mesh.normals, mesh.uvs, mesh.min, mesh.max),
        );
      }

      statusValue.textContent = `Loaded ${meshes.length} primitive(s)`;
    } catch (error) {
      statusValue.textContent = 'Load failed';
      console.error(error);
    }
  };

  void loadModel();

  function loop(now: number): void {
    time.update(now);
    if (time.deltaTime > 0) {
      layout.fpsValue.textContent = (1 / time.deltaTime).toFixed(0);
    }
    renderer.clear(0.08, 0.08, 0.12, 1.0);
    cameraSystem.safeUpdate(em, time.deltaTime);
    renderSystem.safeUpdate(em, time.deltaTime);
    if (renderLoopActive) requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
