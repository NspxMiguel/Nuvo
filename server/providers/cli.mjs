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

  // Grupo próprio de processos: `claude` e `codex` chamam outros binários, e
  // matar só o filho direto deixaria o neto rodando com o modelo pago aberto.
  // No Windows não existe grupo assim; lá o `taskkill` do `kill` já cobre.
  const emGrupo = process.platform !== 'win32';

  const child = spawn(command, args.filter((a) => a !== ''), {
    cwd: req.workdir || cfg.cwd || undefined,
    env: { ...process.env, ...(cfg.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: emGrupo
  });

  let fim = false;

  /** Mata a árvore inteira; ESRCH só quer dizer que já tinha morrido. */
  const matar = (sinal) => {
    try {
      if (emGrupo && child.pid) process.kill(-child.pid, sinal);
      else child.kill(sinal);
    } catch {
      try {
        child.kill(sinal);
      } catch {
        /* já morreu */
      }
    }
  };

  const encerrar = () => {
    if (fim) return;
    matar('SIGTERM');
    // Quem ignora SIGTERM — e há CLI que ignora enquanto escreve — leva SIGKILL.
    const forca = setTimeout(() => {
      if (!fim) matar('SIGKILL');
    }, 3000);
    forca.unref?.();
  };

  // Prompt grande não cabe no cano (uns 64 kB) e fica esperando o outro lado
  // ler. Se o comando sair antes disso, o cano quebra: sem este ouvinte o EPIPE
  // sobe como erro sem dono e derruba o servidor inteiro, não só a conversa.
  child.stdin.on('error', () => {});
  child.stdin.end(useStdin ? prompt : undefined);

  const abort = () => encerrar();
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
    fim = true;
    resolveNext?.();
    resolveNext = null;
  });
  child.on('close', (code) => {
    if (code && code !== 0 && !failure && !req.signal?.aborted) {
      const motivo = erroDoComando.trim().split('\n').filter(Boolean).at(-1);
      failure = new Error(
        motivo ? `${command} saiu com código ${code}: ${motivo}` : `${command} saiu com código ${code}`
      );
    }
    done = true;
    fim = true;
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
    // Sair daqui por qualquer motivo — cancelamento, prazo vencido, erro de
    // quem lê — não pode deixar o processo do modelo rodando sozinho.
    encerrar();
  }
}
