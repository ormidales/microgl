import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('../src/demoLayout.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const transformDemoSource = readFileSync(new URL('../src/demos/transform.ts', import.meta.url), 'utf8');
const themeCss = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');

describe('Demo scene layout', () => {
  it('defines a shared demo structure with top bar, back link, and FPS panel', () => {
    expect(layoutSource).toContain("topbar.className = 'demo-topbar'");
    expect(layoutSource).toContain("backLink.href = '/gallery.html'");
    expect(layoutSource).toContain("performancePanel.className = 'demo-performance-panel'");
    expect(layoutSource).toContain("fpsLabel.textContent = 'FPS: '");
  });

  it('boots the transform demo entrypoint from main', () => {
    expect(mainSource).toContain("import { runTransformDemo } from './demos/transform'");
    expect(mainSource).toContain('runTransformDemo()');
  });

  it('updates transform rotation values from Time.deltaTime and displays them', () => {
    expect(transformDemoSource).toContain('transform.rotationX += deltaTime');
    expect(transformDemoSource).toContain('transform.rotationY += deltaTime * 1.4');
    expect(transformDemoSource).toContain("rotationXLabel.textContent = 'Rotation X: '");
    expect(transformDemoSource).toContain("rotationYLabel.textContent = 'Rotation Y: '");
  });

  it('provides shared theme styles for demo layout elements', () => {
    expect(themeCss).toContain('.demo-topbar');
    expect(themeCss).toContain('.demo-canvas-container');
    expect(themeCss).toContain('.demo-performance-panel');
  });
});
