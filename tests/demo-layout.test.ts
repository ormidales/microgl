import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('../src/demoLayout.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const gltfDemoSource = readFileSync(new URL('../src/demos/gltf.ts', import.meta.url), 'utf8');
const themeCss = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');

describe('Demo scene layout', () => {
  it('defines a shared demo structure with top bar, back link, and FPS panel', () => {
    expect(layoutSource).toContain("topbar.className = 'demo-topbar'");
    expect(layoutSource).toContain("backLink.href = '/gallery.html'");
    expect(layoutSource).toContain("performancePanel.className = 'demo-performance-panel'");
    expect(layoutSource).toContain("fpsLabel.textContent = 'FPS: '");
    expect(layoutSource).toContain('controls: string[] = []');
    expect(layoutSource).toContain('for (const control of controls)');
  });

  it('boots the gltf demo entrypoint from main', () => {
    expect(mainSource).toContain("import { runGltfDemo } from './demos/gltf'");
    expect(mainSource).toContain('runGltfDemo()');
  });

  it('loads a glb model asynchronously and maps primitives to mesh entities', () => {
    expect(gltfDemoSource).toContain("const MODEL_URL = '/models/quad.glb'");
    expect(gltfDemoSource).toContain('await fetch(MODEL_URL)');
    expect(gltfDemoSource).toContain('await loadGltf(await response.arrayBuffer())');
    expect(gltfDemoSource).toContain('new MeshComponent(mesh.positions, mesh.indices, mesh.normals, mesh.uvs, mesh.min, mesh.max)');
  });

  it('provides shared theme styles for demo layout elements', () => {
    expect(themeCss).toContain('.demo-topbar');
    expect(themeCss).toContain('.demo-canvas-container');
    expect(themeCss).toContain('.demo-performance-panel');
  });
});
