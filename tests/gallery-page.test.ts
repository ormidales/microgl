import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const galleryHtml = readFileSync(new URL('../gallery.html', import.meta.url), 'utf8');

describe('Gallery page', () => {
  it('renders a responsive gallery grid', () => {
    expect(galleryHtml).toContain('class="gallery-grid"');
    expect(galleryHtml).toContain('OrbitalCameraSystem');
    expect(galleryHtml).toContain('MeshComponent');
    expect(galleryHtml).toContain('10,000 animated triangles');
    expect(galleryHtml).toContain('glTF');
  });

  it('exposes anchor ids used by demos.html links', () => {
    expect(galleryHtml).toContain('id="orbital-camera-control"');
    expect(galleryHtml).toContain('id="mesh-render-loop"');
    expect(galleryHtml).toContain('id="ecs-stress-test"');
    expect(galleryHtml).toContain('id="gltf-scene-loader"');
  });

  it('links cards with implemented demos to the correct ?demo= route', () => {
    expect(galleryHtml).toMatch(/<a href="\/demo\.html\?demo=stress">Open demo<\/a>/);
    expect(galleryHtml).toMatch(/<a href="\/demo\.html\?demo=gltf">Open demo<\/a>/);
  });

  it('marks unimplemented demo cards as coming soon instead of linking to a mismatched route', () => {
    expect(galleryHtml).not.toMatch(/id="orbital-camera-control"[^]*?<a href="\/demo\.html"/);
    expect(galleryHtml).not.toMatch(/id="mesh-render-loop"[^]*?<a href="\/demo\.html"/);
    expect(galleryHtml).toContain('Demo coming soon');
  });
});
