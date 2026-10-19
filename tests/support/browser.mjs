import { launch } from 'puppeteer-core';
import { browserPath } from '../../server/pdf-export.mjs';
export async function testBrowser() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|localappdata|userprofile|home|lang|display|xdg_runtime_dir)$/i.test(key)));
  return launch({executablePath:browserPath(),headless:true,pipe:true,env,timeout:30000});
}
