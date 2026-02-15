export interface DemoLayout {
  canvasContainer: HTMLDivElement;
  performancePanel: HTMLElement;
  fpsValue: HTMLOutputElement;
}

/**
 * Builds the shared DOM structure used by demo scenes.
 */
export function createDemoLayout(title: string): DemoLayout {
  document.body.classList.add('demo-page');
  document.body.replaceChildren();

  const shell = document.createElement('div');
  shell.className = 'demo-shell';

  const topbar = document.createElement('header');
  topbar.className = 'demo-topbar';

  const backLink = document.createElement('a');
  backLink.className = 'demo-back-link';
  backLink.href = '/gallery.html';
  backLink.textContent = '← Back to gallery';

  const heading = document.createElement('h1');
  heading.className = 'demo-title';
  heading.textContent = title;

  topbar.append(backLink, heading);

  const stage = document.createElement('div');
  stage.className = 'demo-stage';

  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'demo-canvas-container';

  const performancePanel = document.createElement('aside');
  performancePanel.className = 'demo-performance-panel';
  performancePanel.setAttribute('aria-live', 'off');

  const fpsLabel = document.createElement('p');
  fpsLabel.textContent = 'FPS: ';

  const fpsValue = document.createElement('output');
  fpsValue.textContent = '0';
  fpsLabel.append(fpsValue);
  performancePanel.append(fpsLabel);

  stage.append(canvasContainer, performancePanel);
  shell.append(topbar, stage);
  document.body.append(shell);

  return { canvasContainer, performancePanel, fpsValue };
}
