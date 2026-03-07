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
  System,
  TransformComponent,
} from '../core/ecs';
import { quat } from 'gl-matrix';

const ROTATION_X_SPEED = 1;
const ROTATION_Y_SPEED = 1.4;

class RotateCubeSystem extends System {
  public readonly requiredComponents = ['Transform'] as const;
  private accRotationX = 0;
  private accRotationY = 0;

  constructor(
    private readonly rotationXValue: HTMLOutputElement,
    private readonly rotationYValue: HTMLOutputElement,
  ) {
    super();
  }

  update(em: EntityManager, deltaTime: number): void {
    this.accRotationX += deltaTime * ROTATION_X_SPEED;
    this.accRotationY += deltaTime * ROTATION_Y_SPEED;
    this.rotationXValue.textContent = this.accRotationX.toFixed(2);
    this.rotationYValue.textContent = this.accRotationY.toFixed(2);
    const entities = em.getEntitiesWith(...this.requiredComponents);
    for (const id of entities) {
      const transform = em.getComponent<TransformComponent>(id, 'Transform');
      if (!transform) continue;
      quat.rotateX(transform.rotation, transform.rotation, deltaTime * ROTATION_X_SPEED);
      quat.rotateY(transform.rotation, transform.rotation, deltaTime * ROTATION_Y_SPEED);
    }
  }
}

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

export function runTransformDemo(): void {
  const layout = createDemoLayout('Transform demo');
  const renderer = new Renderer(layout.canvasContainer);
  const time = new Time();
  const material = new Material(renderer.gl);

  const rotationXLabel = document.createElement('p');
  rotationXLabel.textContent = 'Rotation X: ';
  const rotationXValue = document.createElement('output');
  rotationXValue.textContent = '0.00';
  rotationXLabel.append(rotationXValue);

  const rotationYLabel = document.createElement('p');
  rotationYLabel.textContent = 'Rotation Y: ';
  const rotationYValue = document.createElement('output');
  rotationYValue.textContent = '0.00';
  rotationYLabel.append(rotationYValue);
  layout.performancePanel.append(rotationXLabel, rotationYLabel);

  const em = new EntityManager();
  const renderSystem = new RenderSystem(renderer, material);
  const cameraSystem = new OrbitalCameraSystem();
  const rotateCubeSystem = new RotateCubeSystem(rotationXValue, rotationYValue);
  cameraSystem.attach(renderer.canvas);
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
  em.addComponent(camera, new CameraComponent());

  const cube = em.createEntity();
  em.addComponent(cube, new TransformComponent());
  em.addComponent(cube, new MeshComponent(createCubeVertices()));

  function loop(now: number): void {
    time.update(now);
    if (time.deltaTime > 0) {
      layout.fpsValue.textContent = (1 / time.deltaTime).toFixed(0);
    }
    renderer.clear(0.1, 0.1, 0.1, 1.0);

    rotateCubeSystem.update(em, time.deltaTime);
    cameraSystem.update(em, time.deltaTime);
    renderSystem.update(em, time.deltaTime);

    if (renderLoopActive) requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
