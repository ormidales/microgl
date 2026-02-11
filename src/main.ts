import { Renderer } from './core/Renderer';
import { Time } from './core/Time';
import {
  EntityManager,
  TransformComponent,
  MeshComponent,
  RenderSystem,
} from './core/ecs';

const renderer = new Renderer();
const time = new Time();

// --- ECS setup ---
const em = new EntityManager();
const renderSystem = new RenderSystem();

// Create a sample entity with Transform + Mesh components
const entity = em.createEntity();
em.addComponent(entity, new TransformComponent(0, 1, -5));
em.addComponent(
  entity,
  new MeshComponent(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
);

function loop(now: number): void {
  time.update(now);
  renderer.clear(0.1, 0.1, 0.1, 1.0);

  // Update all ECS systems
  renderSystem.update(em, time.deltaTime);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
