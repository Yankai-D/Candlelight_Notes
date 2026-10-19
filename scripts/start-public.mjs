import { preparePublicMaterials } from './prepare-public-materials.mjs';
import { runNode } from './lib/process.mjs';
const { library } = await preparePublicMaterials();
await runNode(['server/index.mjs', '--dev'], { env: { ...process.env, READING_TREE_LIBRARY_DIR: library } });
