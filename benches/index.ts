#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';
import url from 'url';
import si from 'systeminformation';

const dirname = url.fileURLToPath(new URL('.', import.meta.url));

async function main(): Promise<void> {
  await fs.promises.mkdir(path.join(dirname, 'results'), { recursive: true });
  const resultFilenames = await fs.promises.readdir(
    path.join(dirname, 'results'),
  );
  const metricsFile = await fs.promises.open(
    path.join(dirname, 'results', 'metrics.txt'),
    'w',
  );
  let concatenating = false;
  for (const resultFilename of resultFilenames) {
    if (/.+_metrics\.txt$/.test(resultFilename)) {
      const metricsData = await fs.promises.readFile(
        path.join(dirname, 'results', resultFilename),
      );
      if (concatenating) {
        await metricsFile.write('\n');
      }
      await metricsFile.write(metricsData);
      concatenating = true;
    }
  }
  await metricsFile.close();
  const systemData = await si.get({
    cpu: '*',
    osInfo: 'platform, distro, release, kernel, arch',
    system: 'model, manufacturer',
  });
  await fs.promises.writeFile(
    path.join(dirname, 'results', 'system.json'),
    JSON.stringify(systemData, null, 2),
  );
}

void main();
