import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidate = path.join(root, 'tmp/package-candidate');

function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function main() {
  fs.rmSync(candidate, { recursive: true, force: true });
  fs.mkdirSync(candidate, { recursive: true });
  const manifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const packageJSON = JSON.parse(manifest);
  assert.equal(packageJSON.type, 'module');
  assert.equal(packageJSON.engines.node, '>=24.0.0');
  assert.equal(packageJSON.main, './dist/index.js');
  assert.equal(packageJSON.types, './dist/index.d.ts');
  assert.equal(packageJSON.devDependencies?.['@matrixai/lint'], undefined);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let packed;
  if (process.env.PACKAGE_ARCHIVE != null) {
    const archive = path.resolve(process.env.PACKAGE_ARCHIVE);
    const filename = path.basename(archive);
    fs.copyFileSync(archive, path.join(candidate, filename));
    packed = {
      name: packageJSON.name,
      version: packageJSON.version,
      filename,
      files: run('tar', ['-tzf', archive])
        .trim()
        .split('\n')
        .map((file) => ({
          path: file.replace(/^package\//, ''),
        })),
    };
  } else {
    [packed] = JSON.parse(
      run(npm, [
        'pack',
        '--offline',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        candidate,
      ]),
    );
  }
  assert.equal(packed.name, packageJSON.name);
  assert.equal(packed.version, packageJSON.version);
  const files = packed.files.map((file) => file.path);
  for (const file of files) {
    assert.ok(
      /^(?:dist\/.*\.(?:js|js\.map|d\.ts)|package\.json|README\.md|LICENSE)$/.test(
        file,
      ),
      `Unexpected package entry: ${file}`,
    );
  }
  const modules = fs
    .readdirSync(path.join(root, 'dist'), { recursive: true })
    .filter((file) => file.endsWith('.js'))
    .map((file) => file.replaceAll('\\', '/').slice(0, -3));
  for (const module of modules) {
    assert.ok(files.includes(`dist/${module}.js`));
    assert.ok(files.includes(`dist/${module}.d.ts`));
  }
  run('tar', ['-xzf', path.join(candidate, packed.filename), '-C', candidate]);
  const packageRoot = path.join(candidate, 'package');
  assert.equal(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    manifest,
  );
  const consumer = path.join(candidate, 'consumer');
  const scope = path.join(consumer, 'node_modules/@matrixai');
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(packageRoot, path.join(scope, 'rpc'), 'dir');
  fs.writeFileSync(path.join(consumer, 'package.json'), '{"type":"module"}\n');
  fs.symlinkSync(
    path.join(root, 'node_modules'),
    path.join(packageRoot, 'node_modules'),
    'dir',
  );
  try {
    run(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      import assert from 'node:assert/strict';
      const rootModule = await import('@matrixai/rpc');
      assert.ok(Object.keys(rootModule).length > 0);
      for (const module of ${JSON.stringify(modules)}) {
        await import('@matrixai/rpc/' + module + '.js');
      }
      const metadata = await import('@matrixai/rpc/package.json', { with: { type: 'json' } });
      assert.equal(metadata.default.version, ${JSON.stringify(packageJSON.version)});
    `,
      ],
      consumer,
    );
    const fixture = path.join(consumer, 'consumer.mts');
    fs.writeFileSync(
      fixture,
      "import * as api from '@matrixai/rpc';\nvoid api;\n",
    );
    const configFile = ts.readConfigFile(
      path.join(root, 'tsconfig.json'),
      ts.sys.readFile,
    );
    assert.equal(configFile.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      root,
    );
    const program = ts.createProgram([fixture], {
      ...parsed.options,
      noEmit: true,
      incremental: false,
      tsBuildInfoFile: undefined,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
      diagnostics.length,
      0,
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    );
  } finally {
    fs.rmSync(path.join(packageRoot, 'node_modules'), { force: true });
    fs.rmSync(path.join(consumer, 'node_modules'), {
      recursive: true,
      force: true,
    });
  }
  fs.writeFileSync(
    path.join(candidate, 'report.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        status: 'passed',
        name: packageJSON.name,
        version: packageJSON.version,
        runtime: process.version,
        archive: packed.filename,
        files,
        checks: [
          'allowlist',
          'canonical-manifest',
          'node-consumers',
          'declaration-consumers',
        ],
        installerTest: false,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'Built package imports, runtime vectors, and declarations passed.\n',
  );
}

main();
