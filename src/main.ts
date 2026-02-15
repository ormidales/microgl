import { runGltfDemo } from './demos/gltf';
import { runStressDemo } from './demos/stress';

const demo = new URLSearchParams(window.location.search).get('demo');

if (demo === 'stress') {
  runStressDemo();
} else {
  runGltfDemo();
}
