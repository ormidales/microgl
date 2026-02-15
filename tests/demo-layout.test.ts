import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('../src/demoLayout.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const themeCss = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');

describe('Demo scene layout', () => {
  it('defines a shared demo structure with top bar, back link, and FPS panel', () => {
    expect(layoutSource).toContain("topbar.className = 'demo-topbar'");
    expect(layoutSource).toContain("backLink.href = '/gallery.html'");
    expect(layoutSource).toContain("performancePanel.className = 'demo-performance-panel'");
    expect(layoutSource).toContain("fpsLabel.textContent = 'FPS: '");
  });

  it('targets the renderer canvas to the shared container and updates fps output', () => {
    expect(mainSource).toContain("new Renderer(layout.canvasContainer)");
    expect(mainSource).toContain("layout.fpsValue.textContent = (1 / time.deltaTime).toFixed(0)");
  });

  it('provides shared theme styles for demo layout elements', () => {
    expect(themeCss).toContain('.demo-topbar');
    expect(themeCss).toContain('.demo-canvas-container');
    expect(themeCss).toContain('.demo-performance-panel');
  });
});
