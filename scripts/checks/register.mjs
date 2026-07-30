import { register } from 'node:module';

register('./loader-hook.mjs', import.meta.url);
