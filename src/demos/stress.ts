import { createDemoLayout } from '../demoLayout';
import { Material } from '../core/Material';
import { Renderer } from '../core/Renderer';
import { Time } from '../core/Time';
import {
  CameraComponent,
  EntityManager,
  MeshComponent,
  RenderSystem,
  System,
  TransformComponent,
} from '../core/ecs';
import { quat } from 'gl-matrix';

const ENTITY_GRID_SIZE = 100;
const ENTITY_SPACING = 0.45;
const MOVE_AMPLITUDE = 0.08;
const MOVE_SPEED = 1.3;
const TURN_SPEED = 0.6;
const POSITION_OFFSET_STEP = 0.19;

class StressMovementSystem extends System {
  public readonly requiredComponents = ['Transform', 'Mesh'] as const;
  private phase = 0;

  update(em: EntityManager, deltaTime: number): void {
    this.phase += deltaTime * MOVE_SPEED;
    const entities = em.getEntitiesWith(...this.requiredComponents);
    for (let i = 0; i < entities.length; i++) {
      const transform = em.getComponent<TransformComponent>(entities[i], 'Transform');
      if (!transform) continue;
      const col = i % ENTITY_GRID_SIZE;
      const row = Math.floor(i / ENTITY_GRID_SIZE);
      transform.y = Math.sin(this.phase + (col + row) * POSITION_OFFSET_STEP) * MOVE_AMPLITUDE;
      quat.rotateY(transform.rotation, transform.rotation, deltaTime * TURN_SPEED);
    }
  }
}

function createTriangleVertices(): Float32Array {
  return new Float32Array([
    0, 0.2, 0,
    -0.1732, -0.1, 0,
    0.1732, -0.1, 0,
  ]);
}

export function runStressDemo(): void {
  const layout = createDemoLayout('ECS stress test', ['10,000 animated triangle entities']);
  const renderer = new Renderer(layout.canvasContainer);
  const time = new Time();
  const material = new Material(renderer.gl);
  const em = new EntityManager();
  const renderSystem = new RenderSystem(renderer, material);
  const movementSystem = new StressMovementSystem();
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

  const camera = em.createEntity();
  em.addComponent(camera, new CameraComponent(Math.PI / 4, 0.1, 200, 55, 1.1, 0));

  const entityCountLabel = document.createElement('p');
  entityCountLabel.textContent = `Entities: ${ENTITY_GRID_SIZE * ENTITY_GRID_SIZE}`;
  layout.performancePanel.append(entityCountLabel);

  const mesh = new MeshComponent(createTriangleVertices());
  const half = ENTITY_GRID_SIZE * ENTITY_SPACING * 0.5;
  for (let row = 0; row < ENTITY_GRID_SIZE; row++) {
    for (let col = 0; col < ENTITY_GRID_SIZE; col++) {
      const entity = em.createEntity();
      em.addComponent(entity, new TransformComponent(
        (col * ENTITY_SPACING) - half,
        0,
        (row * ENTITY_SPACING) - half,
      ));
      em.addComponent(entity, mesh);
    }
  }

  function loop(now: number): void {
    time.update(now);
    if (time.deltaTime > 0) {
      layout.fpsValue.textContent = (1 / time.deltaTime).toFixed(0);
    }
    renderer.clear(0.05, 0.05, 0.08, 1.0);
    movementSystem.safeUpdate(em, time.deltaTime);
    renderSystem.safeUpdate(em, time.deltaTime);
    if (renderLoopActive) requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
