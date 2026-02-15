import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const demosHtml = readFileSync(new URL('../demos.html', import.meta.url), 'utf8');

describe('Demos page', () => {
  it('renders a responsive demos grid with technical ECS descriptions', () => {
    expect(demosHtml).toContain('class="demos-grid"');
    expect(demosHtml).toContain('TransformComponent');
    expect(demosHtml).toContain('OrbitalCameraSystem');
    expect(demosHtml).toContain('MeshComponent');
  });

  it('contains clickable links for each demo card', () => {
    expect(demosHtml).toMatch(/<a href="\/gallery\.html#entity-transform-pipeline">Open demo<\/a>/);
    expect(demosHtml).toMatch(/<a href="\/gallery\.html#orbital-camera-control">Open demo<\/a>/);
    expect(demosHtml).toMatch(/<a href="\/gallery\.html#mesh-render-loop">Open demo<\/a>/);
  });
});
