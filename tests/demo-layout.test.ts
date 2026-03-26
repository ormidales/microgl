import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('../src/demoLayout.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const gltfDemoSource = readFileSync(new URL('../src/demos/gltf.ts', import.meta.url), 'utf8');
const cameraDemoSource = readFileSync(new URL('../src/demos/camera.ts', import.meta.url), 'utf8');
const transformDemoSource = readFileSync(new URL('../src/demos/transform.ts', import.meta.url), 'utf8');
const stressDemoSource = readFileSync(new URL('../src/demos/stress.ts', import.meta.url), 'utf8');
const themeCss = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');
const orbitalSystemSource = readFileSync(new URL('../src/core/ecs/systems/OrbitalCameraSystem.ts', import.meta.url), 'utf8');

describe('Demo scene layout', () => {
  it('defines a shared demo structure with top bar, back link, and FPS panel', () => {
    expect(layoutSource).toContain("topbar.className = 'demo-topbar'");
    expect(layoutSource).toContain("backLink.href = '/gallery.html'");
    expect(layoutSource).toContain("performancePanel.className = 'demo-performance-panel'");
    expect(layoutSource).toContain("fpsLabel.textContent = 'FPS: '");
    expect(layoutSource).toContain('controls: string[] = []');
    expect(layoutSource).toContain('for (const control of controls)');
  });

  it('createDemoLayout has a JSDoc block with @param and @returns tags', () => {
    expect(layoutSource).toContain('@param title');
    expect(layoutSource).toContain('@param controls');
    expect(layoutSource).toContain('@returns');
  });

  it('boots the gltf demo entrypoint from main', () => {
    expect(mainSource).toContain("import { runGltfDemo } from './demos/gltf'");
    expect(mainSource).toContain('runGltfDemo()');
  });

  it('loads a glb model asynchronously and maps primitives to mesh entities', () => {
    expect(gltfDemoSource).toContain("const MODEL_URL = '/models/quad.glb'");
    expect(gltfDemoSource).toContain('await fetch(MODEL_URL, { signal })');
    expect(gltfDemoSource).toContain('await loadGltf(await response.arrayBuffer())');
    expect(gltfDemoSource).toContain('new MeshComponent(mesh.positions, mesh.indices, mesh.normals, mesh.uvs, mesh.min, mesh.max)');
  });

  it('guards loadModel against concurrent calls with AbortController', () => {
    expect(gltfDemoSource).toContain('let loadController: AbortController | null = null');
    expect(gltfDemoSource).toContain('loadController?.abort()');
    expect(gltfDemoSource).toContain('loadController = new AbortController()');
    expect(gltfDemoSource).toContain('const { signal } = loadController');
    expect(gltfDemoSource).toContain('if (signal.aborted) return');
    expect(gltfDemoSource).toContain("(error as Error).name === 'AbortError'");
  });

  it('provides shared theme styles for demo layout elements', () => {
    expect(themeCss).toContain('.demo-topbar');
    expect(themeCss).toContain('.demo-canvas-container');
    expect(themeCss).toContain('.demo-performance-panel');
  });

  it('has a responsive media query that docks the performance panel below the canvas on small screens', () => {
    const queryStart = themeCss.indexOf('@media (max-width: 767px)');
    expect(queryStart).toBeGreaterThanOrEqual(0);

    // Extract only the content inside the @media block by balancing braces.
    let depth = 0;
    let blockEnd = -1;
    for (let i = queryStart; i < themeCss.length; i++) {
      if (themeCss[i] === '{') depth++;
      else if (themeCss[i] === '}') {
        depth--;
        if (depth === 0) { blockEnd = i; break; }
      }
    }
    expect(blockEnd).toBeGreaterThan(queryStart);
    const mediaBlock = themeCss.slice(queryStart, blockEnd + 1);

    expect(mediaBlock).toContain('flex-direction: column');
    expect(mediaBlock).toContain('position: static');
    expect(mediaBlock).toContain('pointer-events: none');
  });

  it('OrbitalCameraSystem.attach JSDoc warns that detach must be called on cleanup', () => {
    expect(orbitalSystemSource).toContain('detach');
    expect(orbitalSystemSource).toContain('pagehide');
  });

  it('camera demo calls cameraSystem.detach() on pagehide', () => {
    expect(cameraDemoSource).toContain("window.addEventListener('pagehide'");
    expect(cameraDemoSource).toContain('cameraSystem.detach()');
  });

  it('gltf demo calls cameraSystem.detach() on pagehide', () => {
    expect(gltfDemoSource).toContain("window.addEventListener('pagehide'");
    expect(gltfDemoSource).toContain('cameraSystem.detach()');
  });

  it('transform demo calls cameraSystem.detach() on pagehide', () => {
    expect(transformDemoSource).toContain("window.addEventListener('pagehide'");
    expect(transformDemoSource).toContain('cameraSystem.detach()');
  });

  it('camera demo calls time.reset() in onContextRestored to prevent elapsed drift', () => {
    const restoreIdx = cameraDemoSource.indexOf('onContextRestored');
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    const restoreBlock = cameraDemoSource.slice(restoreIdx);
    expect(restoreBlock).toContain('time.reset()');
  });

  it('stress demo calls time.reset() in onContextRestored to prevent elapsed drift', () => {
    const restoreIdx = stressDemoSource.indexOf('onContextRestored');
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    const restoreBlock = stressDemoSource.slice(restoreIdx);
    expect(restoreBlock).toContain('time.reset()');
  });

  it('gltf demo calls time.reset() in onContextRestored to prevent elapsed drift', () => {
    const restoreIdx = gltfDemoSource.indexOf('onContextRestored');
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    const restoreBlock = gltfDemoSource.slice(restoreIdx);
    expect(restoreBlock).toContain('time.reset()');
  });

  it('transform demo calls time.reset() in onContextRestored to prevent elapsed drift', () => {
    const restoreIdx = transformDemoSource.indexOf('onContextRestored');
    expect(restoreIdx).toBeGreaterThanOrEqual(0);
    const restoreBlock = transformDemoSource.slice(restoreIdx);
    expect(restoreBlock).toContain('time.reset()');
  });
});
