import { spawn } from "bun";
import type { Subprocess } from "bun";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "fs";

export interface ServerWebSocket<T = unknown> {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  data: T;
}

interface Session {
  proc: Subprocess<"pipe", "pipe", "pipe">;
  rows: number;
  cols: number;
  isFallback?: boolean;
}

const activeSessions = new Map<ServerWebSocket<any>, Session>();

let supervisorKeysSynced = false;

async function syncPublicKeyToSupervisorSshAddons(pubKey: string) {
  if (supervisorKeysSynced) return;
  supervisorKeysSynced = true;

  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return;

  try {
    const res = await fetch("http://supervisor/addons", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const data: any = await res.json();
    const addons: any[] = data?.data?.addons || [];

    const sshAddons = addons.filter((a) =>
      a.slug?.includes("ssh") || a.slug?.includes("terminal")
    );

    for (const addon of sshAddons) {
      try {
        const infoRes = await fetch(`http://supervisor/addons/${addon.slug}/info`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!infoRes.ok) continue;

        const info: any = await infoRes.json();
        const options = info?.data?.options || {};

        const rootKeys: string[] = Array.isArray(options.authorized_keys) ? options.authorized_keys : [];
        const nestedKeys: string[] = Array.isArray(options.ssh?.authorized_keys) ? options.ssh.authorized_keys : [];
        const optionsJson = JSON.stringify(options);

        const alreadyPresent =
          rootKeys.includes(pubKey) ||
          nestedKeys.includes(pubKey) ||
          optionsJson.includes(pubKey.trim());

        if (!alreadyPresent) {
          console.log(`Adding hapro public key to ${addon.slug} options via Supervisor API...`);
          const updatedOptions = { ...options };

          if (Array.isArray(options.authorized_keys)) {
            updatedOptions.authorized_keys = [...rootKeys, pubKey];
          }
          if (options.ssh && (Array.isArray(options.ssh.authorized_keys) || typeof options.ssh === "object")) {
            updatedOptions.ssh = {
              ...options.ssh,
              authorized_keys: [...nestedKeys, pubKey],
            };
          }
          if (!Array.isArray(options.authorized_keys) && !options.ssh) {
            updatedOptions.authorized_keys = [pubKey];
          }

          const updateRes = await fetch(`http://supervisor/addons/${addon.slug}/options`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ options: updatedOptions }),
          });

          if (updateRes.ok) {
            console.log(`Successfully updated ${addon.slug} options. Restarting add-on...`);
            await fetch(`http://supervisor/addons/${addon.slug}/restart`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
      } catch (err: any) {
        console.log(`Failed to sync key to ${addon.slug}:`, err?.message);
      }
    }
  } catch (err: any) {
    console.log("Error querying Supervisor add-ons API:", err?.message);
  }
}

function setupSshKeys(): string | null {
  const keyPath = "/root/.ssh/id_ed25519";
  const pubPath = "/root/.ssh/id_ed25519.pub";

  try {
    if (!existsSync("/root/.ssh")) {
      mkdirSync("/root/.ssh", { recursive: true, mode: 0o700 });
    }
    Bun.spawnSync(["chmod", "700", "/root/.ssh"]);

    if (!existsSync(keyPath)) {
      console.log("Generating hapro SSH key pair...");
      Bun.spawnSync(["ssh-keygen", "-t", "ed25519", "-N", "", "-f", keyPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      Bun.spawnSync(["chmod", "600", keyPath]);
    }

    if (existsSync(pubPath)) {
      const pubKey = readFileSync(pubPath, "utf-8").trim();

      const targetDirs = [
        "/homeassistant/.ssh",
        "/ssl",
        "/share",
        "/root/.ssh",
      ];

      for (const dir of targetDirs) {
        if (existsSync(dir) || dir === "/homeassistant/.ssh") {
          try {
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true, mode: 0o700 });
            }
            Bun.spawnSync(["chmod", "700", dir]);

            const authKeysPath = `${dir}/authorized_keys`;
            let existing = "";
            if (existsSync(authKeysPath)) {
              existing = readFileSync(authKeysPath, "utf-8");
            }

            if (!existing.includes(pubKey)) {
              console.log(`Adding hapro public key to ${authKeysPath}`);
              appendFileSync(authKeysPath, `\n${pubKey}\n`);
            }
            Bun.spawnSync(["chmod", "600", authKeysPath]);
          } catch {
            // ignore unwriteable directory
          }
        }
      }
      syncPublicKeyToSupervisorSshAddons(pubKey).catch(() => { });

      return keyPath;
    }
  } catch (err: any) {
    console.log("Error configuring SSH key pair:", err?.message);
  }

  return null;
}

function sendResize(session: Session, rows: number, cols: number) {
  session.rows = rows;
  session.cols = cols;
  try {
    session.proc.stdin.write(`\x15stty rows ${rows} cols ${cols}\r`);
    session.proc.kill("SIGWINCH");
  } catch {
    // session closing
  }
}

function getSshCandidateCommand(
  keyPath: string | null,
  rows: number,
  cols: number
): { cmd: string[]; isSsh: boolean } {
  const endpoints = [
    { ip: "172.30.32.1", port: "22222" },
    { ip: "172.30.32.1", port: "22" },
    { ip: "127.0.0.1", port: "22" },
  ];
  const candidateUsers = ["root", "hassio", "homeassistant", "admin"];

  for (const ep of endpoints) {
    try {
      const portProbe = Bun.spawnSync(["nc", "-z", "-w", "1", ep.ip, ep.port], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (portProbe.exitCode !== 0) continue;

      console.log(`[LOG] Host SSH port open at ${ep.ip}:${ep.port} — testing SSH key authentication...`);

      if (keyPath) {
        for (const user of candidateUsers) {
          const authProbe = Bun.spawnSync(
            [
              "ssh",
              "-i", keyPath,
              "-o", "BatchMode=yes",
              "-o", "StrictHostKeyChecking=no",
              "-o", "UserKnownHostsFile=/dev/null",
              "-o", "ConnectTimeout=2",
              "-p", ep.port,
              `${user}@${ep.ip}`,
              "true",
            ],
            { stdio: ["pipe", "pipe", "pipe"] }
          );

          if (authProbe.exitCode === 0) {
            console.log(`[LOG] SSH key auth succeeded for ${user}@${ep.ip}:${ep.port}`);
            const sshCmd = `stty rows ${rows} cols ${cols} && exec ssh -tt -i ${keyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=15 -p ${ep.port} ${user}@${ep.ip}`;
            return {
              cmd: ["script", "-q", "-c", sshCmd, "/dev/null"],
              isSsh: true,
            };
          }
        }
      }
    } catch {
      // probe error, check next endpoint
    }
  }

  console.log("[LOG] Host SSH key auth unavailable — using hapro web terminal.");
  const fallbackCmd = `stty rows ${rows} cols ${cols} && exec /bin/bash`;
  return { cmd: ["script", "-q", "-c", fallbackCmd, "/dev/null"], isSsh: false };
}

export function handleSshOpen(ws: ServerWebSocket<any>) {
  let cols = 80;
  let rows = 24;
  if (ws.data && typeof ws.data === "object" && "url" in ws.data) {
    try {
      const reqUrl = new URL((ws.data as any).url);
      const c = parseInt(reqUrl.searchParams.get("cols") || "");
      const r = parseInt(reqUrl.searchParams.get("rows") || "");
      if (!isNaN(c) && c > 0) cols = c;
      if (!isNaN(r) && r > 0) rows = r;
    } catch {}
  }

  const keyPath = setupSshKeys();
  const { cmd, isSsh } = getSshCandidateCommand(keyPath, rows, cols);
  console.log(`Spawning terminal (${cols}x${rows}):`, cmd.join(" "));

  let proc = spawn(cmd, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      TERM: "xterm-256color",
      HOME: "/root",
      LANG: "en_US.UTF-8",
      COLUMNS: cols.toString(),
      LINES: rows.toString(),
    },
  });

  const session: Session = { proc, rows, cols, isFallback: !isSsh };
  activeSessions.set(ws, session);

  const startTime = Date.now();

  (async () => {
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        ws.send(value.buffer as ArrayBuffer);
      }
    } catch { /* closed */ }
  })();

  (async () => {
    const reader = proc.stderr.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        ws.send(value.buffer as ArrayBuffer);
      }
    } catch { /* closed */ }
  })();

  proc.exited.then(async (code) => {
    const runDuration = Date.now() - startTime;

    if (isSsh && code !== 0 && runDuration < 3000) {
      console.log(`[LOG] SSH session exited early (exit code ${code} after ${runDuration}ms) — falling back to hapro web terminal.`);
      ws.send(new TextEncoder().encode("\r\n\x1b[33mSSH passthrough closed — falling back to hapro web terminal...\x1b[0m\r\n"));

      const fallbackCmd = ["script", "-q", "-c", "exec /bin/bash", "/dev/null"];
      const fallbackProc = spawn(fallbackCmd, {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          TERM: "xterm-256color",
          HOME: "/root",
          LANG: "en_US.UTF-8",
        },
      });

      session.proc = fallbackProc;
      session.isFallback = true;

      (async () => {
        const reader = fallbackProc.stdout.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            ws.send(value.buffer as ArrayBuffer);
          }
        } catch { /* closed */ }
      })();

      (async () => {
        const reader = fallbackProc.stderr.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            ws.send(value.buffer as ArrayBuffer);
          }
        } catch { /* closed */ }
      })();

      fallbackProc.exited.then((fbCode) => {
        activeSessions.delete(ws);
        try { ws.close(1000, `Terminal session closed (${fbCode})`); } catch { /* closed */ }
      });
      return;
    }

    activeSessions.delete(ws);
    try { ws.close(1000, `Terminal session closed (${code})`); } catch { /* closed */ }
    console.log(`Terminal process exited with code ${code}.`);
  });
}

export function handleSshMessage(
  ws: ServerWebSocket<any>,
  message: string | ArrayBuffer
) {
  const session = activeSessions.get(ws);
  if (!session) return;

  if (typeof message === "string" && message.startsWith("{")) {
    try {
      const msg = JSON.parse(message);
      if (msg.type === "resize" && msg.rows && msg.cols) {
        sendResize(session, msg.rows, msg.cols);
        return;
      }
    } catch { /* not JSON, fall through */ }
  }

  if (typeof message === "string") {
    session.proc.stdin.write(message);
  } else {
    session.proc.stdin.write(new Uint8Array(message));
  }
}

export function handleSshClose(ws: ServerWebSocket<any>) {
  const session = activeSessions.get(ws);
  if (!session) return;
  try { session.proc.kill(); } catch { /* already dead */ }
  activeSessions.delete(ws);
  console.log("SSH bridge WebSocket closed.");
}
