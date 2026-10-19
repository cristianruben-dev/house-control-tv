import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// TV WebViews are often years old (Android TV 11 ships Chrome 8x–9x): compile down so the 3D home still runs there.
export default defineConfig({build:{target:['chrome80','es2019'],rolldownOptions:{input:{main:resolve(import.meta.dirname,'index.html'),widget:resolve(import.meta.dirname,'widget.html')}}}});
