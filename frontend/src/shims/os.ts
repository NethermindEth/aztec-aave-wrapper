/**
 * Browser shim for Node.js os module
 *
 * Provides stub implementations for os functions in browser environments.
 */

export function tmpdir(): string {
  return "/tmp";
}

export function homedir(): string {
  return "/home/user";
}

export function hostname(): string {
  return "localhost";
}

export function platform(): string {
  return "browser";
}

export function arch(): string {
  return "wasm32";
}

export function type(): string {
  return "Browser";
}

export function release(): string {
  return "1.0.0";
}

export function cpus(): object[] {
  return [{ model: "Browser", speed: 0 }];
}

export function totalmem(): number {
  return 0;
}

export function freemem(): number {
  return 0;
}

export function uptime(): number {
  return 0;
}

export function networkInterfaces(): Record<string, unknown[]> {
  return {};
}

export function userInfo(): object {
  return { username: "user", uid: 0, gid: 0, shell: "", homedir: "/home/user" };
}

export const EOL = "\n";

export const constants = {
  signals: {},
  errno: {},
  priority: {},
};

export default {
  tmpdir,
  homedir,
  hostname,
  platform,
  arch,
  type,
  release,
  cpus,
  totalmem,
  freemem,
  uptime,
  networkInterfaces,
  userInfo,
  EOL,
  constants,
};
