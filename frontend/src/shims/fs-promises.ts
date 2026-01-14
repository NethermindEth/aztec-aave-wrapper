/**
 * Browser shim for Node.js fs/promises module
 *
 * Provides stub implementations for filesystem operations in browser environments.
 * These functions throw errors as they cannot work in browsers.
 */

export async function mkdir(_path: string, _options?: object): Promise<void> {
  throw new Error("mkdir is not available in browser environments");
}

export async function rm(_path: string, _options?: object): Promise<void> {
  throw new Error("rm is not available in browser environments");
}

export async function readFile(_path: string, _options?: object): Promise<Buffer | string> {
  throw new Error("readFile is not available in browser environments");
}

export async function writeFile(
  _path: string,
  _data: string | Buffer,
  _options?: object
): Promise<void> {
  throw new Error("writeFile is not available in browser environments");
}

export async function readdir(_path: string, _options?: object): Promise<string[]> {
  throw new Error("readdir is not available in browser environments");
}

export async function stat(_path: string): Promise<object> {
  throw new Error("stat is not available in browser environments");
}

export async function access(_path: string, _mode?: number): Promise<void> {
  throw new Error("access is not available in browser environments");
}

export async function unlink(_path: string): Promise<void> {
  throw new Error("unlink is not available in browser environments");
}

export async function rename(_oldPath: string, _newPath: string): Promise<void> {
  throw new Error("rename is not available in browser environments");
}

export async function copyFile(_src: string, _dest: string): Promise<void> {
  throw new Error("copyFile is not available in browser environments");
}

export async function mkdtemp(_prefix: string): Promise<string> {
  throw new Error("mkdtemp is not available in browser environments");
}

export async function realpath(_path: string): Promise<string> {
  throw new Error("realpath is not available in browser environments");
}

export async function lstat(_path: string): Promise<object> {
  throw new Error("lstat is not available in browser environments");
}

export async function symlink(_target: string, _path: string): Promise<void> {
  throw new Error("symlink is not available in browser environments");
}

export default {
  mkdir,
  rm,
  readFile,
  writeFile,
  readdir,
  stat,
  access,
  unlink,
  rename,
  copyFile,
  mkdtemp,
  realpath,
  lstat,
  symlink,
};
