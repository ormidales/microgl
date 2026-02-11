import { Renderer } from './core/Renderer';
import { Time } from './core/Time';

const renderer = new Renderer();
const time = new Time();

function loop(now: number): void {
  time.update(now);
  renderer.clear(0.1, 0.1, 0.1, 1.0);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
