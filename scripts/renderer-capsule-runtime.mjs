import { resolvePackageRuntime, stagePackageRuntime, verifyPackageRuntime } from './capsule-package-runtime.mjs';

export const resolveRendererRuntime = (declaration, sourceRoot) =>
  resolvePackageRuntime(declaration, sourceRoot, ['react', 'react-dom', 'happy-dom'], 'Renderer runtime');
export const stageRendererRuntime = stagePackageRuntime;
export const verifyRendererRuntime = verifyPackageRuntime;
