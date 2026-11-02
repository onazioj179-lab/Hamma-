// Keep root-level Vite invocations aligned with the web workspace.
import { mergeConfig } from 'vite';
import path from 'path';
import webConfig from './web/vite.config';

export default mergeConfig(webConfig, {
  root: path.resolve(__dirname, 'web'),
});
