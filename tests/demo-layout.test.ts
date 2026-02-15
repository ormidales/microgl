import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('../src/demoLayout.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const cameraDemoSource = readFileSync(new URL('../src/demos/camera.ts', import.meta.url), 'utf8');
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

  it('boots the camera demo entrypoint from main', () => {
    expect(mainSource).toContain("import { runCameraDemo } from './demos/camera'");
    expect(mainSource).toContain('runCameraDemo()');
  });

  it('defines orbital camera controls and a cube grid scene for interaction', () => {
    expect(cameraDemoSource).toContain("'Left click + drag: orbit'");
    expect(cameraDemoSource).toContain("'Mouse wheel: zoom (radius clamped)'");
    expect(cameraDemoSource).toContain('for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++)');
    expect(cameraDemoSource).toContain('for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++)');
    expect(cameraDemoSource).toContain('new MeshComponent(cubeVertices)');
  });

  it('provides shared theme styles for demo layout elements', () => {
    expect(themeCss).toContain('.demo-topbar');
    expect(themeCss).toContain('.demo-canvas-container');
    expect(themeCss).toContain('.demo-performance-panel');
  });
});
