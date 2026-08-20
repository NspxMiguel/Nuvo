// Adaptador de IA por linha de comando: `claude`, `codex`, `opencode`, ou
// qualquer binário que aceite um prompt e escreva a resposta no stdout.
//
// A configuração do provedor traz:
//   command  — binário (ex.: "claude")
//   args     — lista de argumentos, com "{{prompt}}" e "{{model}}" substituídos
//   stdin    — true pra mandar o prompt pelo stdin em vez de argumento
//   cwd      — diretório de trabalho (o modo coding usa o do projeto)
//   models   — lista de modelos que esse comando aceita
//
// O pedido pode vir com `estruturado`: aí, se o comando souber falar JSONL, ele
// roda com os argumentos da tabela de eventos e cada linha do stdout vira um
// passo do trabalho (leu, escreveu, rodou) em vez de texto solto.

import { spawn } from 'node:child_process';
import { ARGS_ESTRUTURADO, nomeDoComando, traduzirLinha } from '../eventos-cli.mjs';
import { erroTraduzivel } from '../erro-traduzivel.mjs';

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

/**
 * Argumentos que o próprio app cadastra pra cada CLI — os mesmos de
 * `discovery.mjs`, dos presets de `providers/index.mjs` e da migração do codex
 * em `db.mjs`.
 *
 * Servem de impressão digital: lista idêntica a esta é a que o app pôs ali, e
 * pode ser trocada pela do modo estruturado sem surpresa nenhuma. Qualquer
 * outra coisa foi editada a mão na tela de provedores, e trocar por baixo dos
 * panos faria o comando rodar diferente do que está escrito lá.
 */
const ARGS_DE_FABRICA = {
  claude: ['-p'],
  codex: ['exec', '--skip-git-repo-check', '-'],
  opencode: ['run']
};

function listaIgual(a, b) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((item, i) => String(item) === String(b[i]))
  );
}

export async function* stream(ctx, req) {
  const cfg = ctx.config || {};
  const command = cfg.command;
  if (!command) throw new Error('provedor CLI sem comando configurado');

  const nome = nomeDoComando(command);
  const modoJSONL = req.estruturado ? ARGS_ESTRUTURADO[nome] : null;
  const argsDaPessoa = cfg.args || [];
  // Lista vazia é provedor cadastrado a mão sem argumento nenhum: não há edição
  // pra preservar, então o modo estruturado pode entrar.
  const intactos = argsDaPessoa.length === 0 || listaIgual(argsDaPessoa, ARGS_DE_FABRICA[nome]);
  const estruturado = Boolean(modoJSONL) && intactos;

  // Comando que fala JSONL mas está com os argumentos editados continua rodando
  // do jeito que a pessoa escreveu — e ela precisa saber disso, senão o painel
  // de trabalho fica vazio pra sempre e ninguém liga uma coisa à outra.
  const avisoDeArgs =
    modoJSONL && !estruturado
      ? 'Não liguei o passo a passo: os argumentos deste comando foram editados na configuração e eu mantive os seus. Volte aos argumentos padrão pra ver o que a IA lê, escreve e roda.'
      : null;

  const prompt = flatten(req);
  // Os argumentos do modo estruturado vêm com o jeito de entregar o pedido: são
  // um pacote só. `codex exec --json -` lê do stdin porque termina em `-`, e
  // manter aí o `stdin: false` que a pessoa deixou pra outro comando faria o
  // pedido ir pro lugar errado.
  const useStdin = estruturado ? modoJSONL.stdin !== false : cfg.stdin !== false;
  const brutos = estruturado ? modoJSONL.args : argsDaPessoa;
  const args = brutos.map((a) =>
    String(a)
      .replaceAll('{{model}}', req.model === 'default' ? '' : req.model)
      .replaceAll('{{prompt}}', useStdin ? '' : prompt)
  );
  if (!useStdin && !brutos.some((a) => String(a).includes('{{prompt}}'))) {
    args.push(prompt);
  }

  // A mesma pasta serve pra rodar o comando e pra encurtar o caminho dos
  // arquivos que ele tocar: o painel mostra "web/app.js", não o caminho inteiro
  // da máquina.
  const pasta = req.workdir || cfg.cwd || '';

  // Grupo próprio de processos: `claude` e `codex` chamam outros binários, e
  // matar só o filho direto deixaria o neto rodando com o modelo pago aberto.
  // No Windows não existe grupo assim; lá o `taskkill` do `kill` já cobre.
  const emGrupo = process.platform !== 'win32';

  const child = spawn(command, args.filter((a) => a !== ''), {
    cwd: pasta || undefined,
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
  // Sinal que já chegou cancelado não dispara 'abort' de novo: sem esta linha o
  // processo era criado e ficava rodando até o fim, sem ninguém pra ouvir.
  if (req.signal?.aborted) encerrar();
  else req.signal?.addEventListener('abort', abort, { once: true });

  const chunks = [];
  let resolveNext;
  let done = false;
  let failure = null;

  const push = (value) => {
    chunks.push(value);
    resolveNext?.();
    resolveNext = null;
  };

  if (avisoDeArgs) push({ reasoning: avisoDeArgs });

  // O JSONL chega picado pelo cano: uma linha pode vir metade num 'data' e
  // metade no seguinte. Só o que está antes do último \n está inteiro — meia
  // linha não é erro recuperável no `JSON.parse`, é passo perdido.
  let restoDaLinha = '';

  // `traduzirLinha` engole a linha torta e devolve lista vazia. A garantia
  // importa aqui: isto roda dentro do ouvinte de 'data', onde exceção sobe sem
  // dono e derruba o servidor inteiro, não só esta conversa.
  const emitirLinha = (linha) => {
    for (const pedaco of traduzirLinha(nome, linha, pasta)) push(pedaco);
  };

  // O stderr vira "raciocínio" enquanto roda, mas também é guardado: quando o
  // comando falha, é ele que diz o motivo. "codex saiu com código 1" não ajuda
  // ninguém; "Not inside a trusted directory" resolve o problema.
  let erroDoComando = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    if (!estruturado) {
      push({ delta: d });
      return;
    }
    restoDaLinha += d;
    const corte = restoDaLinha.lastIndexOf('\n');
    if (corte < 0) return;
    for (const linha of restoDaLinha.slice(0, corte).split('\n')) emitirLinha(linha);
    restoDaLinha = restoDaLinha.slice(corte + 1);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => {
    erroDoComando = (erroDoComando + d).slice(-500);
    // O stderr vai como progresso nos dois modos. No estruturado ele foi
    // desligado por um tempo, pra não repetir o pensamento que já vem no
    // stdout — só que é ali que aparece "Not inside a trusted directory", e o
    // turno morria mostrando a frase genérica de resposta vazia, sem o motivo.
    // Ruído a mais numa gaveta fechada é melhor que diagnóstico a menos.
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
    // A última linha costuma vir sem \n no fim — é justamente a do resultado,
    // com tempo e custo do turno.
    if (restoDaLinha) {
      emitirLinha(restoDaLinha);
      restoDaLinha = '';
    }
    if (code && code !== 0 && !failure && !req.signal?.aborted) {
      const motivo = erroDoComando.trim().split('\n').filter(Boolean).at(-1);
      failure = motivo
        ? erroTraduzivel('{comando} saiu com código {codigo}: {motivo}', {
            comando: command,
            codigo: code,
            motivo
          })
        : erroTraduzivel('{comando} saiu com código {codigo}', { comando: command, codigo: code });
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
