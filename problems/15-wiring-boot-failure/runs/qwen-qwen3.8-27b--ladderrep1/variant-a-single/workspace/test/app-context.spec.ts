import { execFile, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const STARTUP_LOG = 'Nest application successfully started';

/**
 * Wiring check: compiles the app with tsc (which emits the decorator metadata
 * Nest needs) and boots the real dist/main.js. Broken provider/export/import
 * wiring, or an import cycle that kills module evaluation, makes the process
 * die before Nest logs its startup line, so this test fails.
 *
 * It deliberately does not call NestFactory.create() in-process: vitest's
 * esbuild transform does not emit design:paramtypes, so a container built
 * inside vitest cannot resolve constructor dependencies even on correct
 * wiring.
 */
describe('application wiring (real build, real boot)', () => {
  it('boots the compiled app to the Nest startup log', async () => {
    await execFileAsync(process.execPath, [tscBin, '-p', 'tsconfig.build.json'], {
      cwd: root,
      timeout: 120_000,
    });

    const child: ChildProcess = spawn(process.execPath, ['dist/main.js'], {
      cwd: root,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const exited = new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
    });

    const reachedStartup = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const onData = (chunk: Buffer | string): void => {
        output += String(chunk);
        if (output.includes(STARTUP_LOG)) {
          finish(true);
        }
      };
      const timer = setTimeout(() => finish(false), 60_000);
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('exit', () => finish(output.includes(STARTUP_LOG)));
      child.on('error', () => finish(false));
    });

    child.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
    child.kill('SIGKILL');

    expect(
      reachedStartup,
      `boot did not reach "${STARTUP_LOG}". Process output:\n${output}`,
    ).toBe(true);
  }, 200_000);
});
