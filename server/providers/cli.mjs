// Adaptador de IA por linha de comando: `claude`, `codex`, `opencode`, ou
// qualquer binário que aceite um prompt e escreva a resposta no stdout.
//
// A configuração do provedor traz:
//   command  — binário (ex.: "claude")
//   args     — lista de argumentos, com "{{prompt}}" e "{{model}}" substituídos
//   stdin    — true pra mandar o prompt pelo stdin em vez de argumento
//   cwd      — diretório de trabalho (o modo coding usa o do projeto)
//   models   — lista de modelos que esse comando aceita

import { spawn } from 'node:child_process';

export const kind = 'cli';

export async function listModels(ctx) {
  const declared = ctx.config?.models;
  if (Array.isArray(declared) && declared.length) {
    return declared.map((m) =>
      typeof m === 'string' ? { model_id: m, label: m, kind: 'chat' } : m
    );
  }
  return [{ model_id: 'default', label: ctx.config?.command || 'cli', kind: 'chat' }];
}

/**
 * Saúde de verdade: `listModels` aqui só repete o que está na configuração e
 * responderia "ok" mesmo com o binário desinstalado. Este teste dispara o
 * processo e o mata na hora — o que interessa é se o sistema consegue achá-lo.
 */
export async function check(ctx) {
  const command = ctx.config?.command;
  if (!command) throw new Error('provedor CLI sem comando configurado');

  await new Promise((resolve, reject) => {
    const child = spawn(command, ['--version'], {
      stdio: 'ignore',
      env: { ...process.env, ...(ctx.config?.env || {}) }
    });
    const timer = setTimeout(() => {
      // Comando que existe mas não entende `--version` pode ficar esperando
      // entrada. Ele existe, que é o que estava sendo perguntado.
      child.kill('SIGKILL');
      resolve();
    }, 4000);
    timer.unref?.();

    child.once('spawn', () => {
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve();
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? new Error(`o comando "${command}" não existe nesta máquina`)
          : err
      );
    });
  });

  return listModels(ctx);
}

/** O CLI não conhece histórico: a conversa inteira vira um prompt de texto. */
function flatten(req) {
  const parts = [];
  if (req.system) parts.push(`# Instruções\n${req.system}`);
  for (const m of req.messages) {
    const who = m.role === 'assistant' ? 'Assistente' : 'Usuário';
    parts.push(`## ${who}\n${m.content}`);
  }
  parts.push('## Assistente');
  return parts.join('\n\n');
}

export async function* stream(ctx, req) {
  const cfg = ctx.config || {};
  const command = cfg.command;
  if (!command) throw new Error('provedor CLI sem comando configurado');

  const prompt = flatten(req);
  const useStdin = cfg.stdin !== false;
  const args = (cfg.args || []).map((a) =>
    String(a)
      .replaceAll('{{model}}', req.model === 'default' ? '' : req.model)
      .replaceAll('{{prompt}}', useStdin ? '' : prompt)
  );
  if (!useStdin && !(cfg.args || []).some((a) => String(a).includes('{{prompt}}'))) {
    args.push(prompt);
  }

  const child = spawn(command, args.filter((a) => a !== ''), {
    cwd: req.workdir || cfg.cwd || undefined,
    env: { ...process.env, ...(cfg.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (useStdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  } else {
    child.stdin.end();
  }

  const abort = () => child.kill('SIGTERM');
  req.signal?.addEventListener('abort', abort, { once: true });

  const chunks = [];
  let resolveNext;
  let done = false;
  let failure = null;

  const push = (value) => {
    chunks.push(value);
    resolveNext?.();
    resolveNext = null;
  };

  // O stderr vira "raciocínio" enquanto roda, mas também é guardado: quando o
  // comando falha, é ele que diz o motivo. "codex saiu com código 1" não ajuda
  // ninguém; "Not inside a trusted directory" resolve o problema.
  let erroDoComando = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => push({ delta: d }));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => {
    erroDoComando = (erroDoComando + d).slice(-500);
    push({ reasoning: d });
  });
  child.on('error', (err) => {
    failure = err;
    done = true;
    resolveNext?.();
    resolveNext = null;
  });
  child.on('close', (code) => {
    if (code && code !== 0 && !failure) {
      const motivo = erroDoComando.trim().split('\n').filter(Boolean).at(-1);
      failure = new Error(
        motivo ? `${command} saiu com código ${code}: ${motivo}` : `${command} saiu com código ${code}`
      );
    }
    done = true;
    resolveNext?.();
    resolveNext = null;
  });

  try {
    while (true) {
      while (chunks.length) yield chunks.shift();
      if (done) break;
      await new Promise((resolve) => {
        resolveNext = resolve;
      });
    }
    while (chunks.length) yield chunks.shift();
    if (failure) throw failure;
  } finally {
    req.signal?.removeEventListener('abort', abort);
  }
}
