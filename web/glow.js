// Brilho de meio-tom: uma malha de pontinhos que sobe do rodapé, atrás da
// pílula de escrever. Nasce ao vivo — âmbar → rosa → roxo → azul em 1,5 s — e
// depois PARA, virando atmosfera parada. Sem biblioteca, sem CDN.
//
//   const brilho = ligarBrilho(canvas);
//   brilho.pulsar();   // na chegada do app e quando a resposta começa
//   brilho.assentar(); // vai direto pro estado final, sem animação

const FASES = [
  [0.0, 42],   // âmbar
  [0.3, 348],  // rosa
  [0.58, 288], // roxo
  [0.82, 232], // azul
  [1.0, 226]   // azul escuro, onde assenta
];

const ESPACO = 10; // px entre pontos da malha
const DUR = 1500;
const AMP_FINAL = 0.3;

function matiz(p) {
  for (let i = 1; i < FASES.length; i++) {
    if (p <= FASES[i][0]) {
      const [p0, h0] = FASES[i - 1];
      const [p1, h1] = FASES[i];
      const k = (p - p0) / (p1 - p0);
      let d = h1 - h0;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      return (h0 + d * k + 360) % 360;
    }
  }
  return FASES[FASES.length - 1][1];
}

// curva de aceleração igual à do CSS: cubic-bezier(.2,.8,.2,1)
function suave(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function ligarBrilho(canvas) {
  const ctx = canvas.getContext('2d');
  const parado = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, dpr = 1, quadro = 0, inicio = 0;

  function medir() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function pintar(p, amp) {
    const hue = matiz(p);
    const cx = w / 2;
    const cy = h * 1.06;            // o foco fica logo abaixo da borda de baixo
    const raio = Math.max(w, h) * 1.02;
    ctx.clearRect(0, 0, w, h);
    for (let y = h - 4; y > -ESPACO; y -= ESPACO) {
      // fileiras alternadas: malha de impressão, não grade de quadriculado
      const off = (Math.round((h - y) / ESPACO) % 2) * (ESPACO / 2);
      for (let x = -ESPACO; x < w + ESPACO; x += ESPACO) {
        const dx = (x + off - cx) / 1.25;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        let t = 1 - d / raio;
        if (t <= 0) continue;
        t = Math.pow(t, 1.9) * amp;
        if (t < 0.012) continue;
        const r = 0.45 + t * 2.4;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${hue.toFixed(1)}, 88%, ${(50 + t * 12).toFixed(1)}%, ${Math.min(0.62, t * 0.95).toFixed(3)})`;
        ctx.arc(x + off, y, r, 0, 6.2832);
        ctx.fill();
      }
    }
  }

  function assentar() {
    cancelAnimationFrame(quadro);
    medir();
    pintar(1, AMP_FINAL);
    canvas.classList.add('on');
  }

  function passo(agora) {
    const t = Math.min(1, (agora - inicio) / DUR);
    // a intensidade sobe rápido e recua um pouco no fim: é o "nascer"
    const sobe = suave(Math.min(1, t / 0.32));
    const amp = sobe * (1 - 0.42 * suave(Math.max(0, (t - 0.4) / 0.6))) * 0.8;
    pintar(t, Math.max(amp, t === 1 ? AMP_FINAL : 0));
    if (t < 1) quadro = requestAnimationFrame(passo);
    else pintar(1, AMP_FINAL); // e para aqui: nada de fundo animado pra sempre
  }

  function pulsar() {
    if (parado) return assentar();
    cancelAnimationFrame(quadro);
    medir();
    canvas.classList.add('on');
    inicio = performance.now();
    quadro = requestAnimationFrame(passo);
  }

  let redim;
  addEventListener('resize', () => {
    clearTimeout(redim);
    redim = setTimeout(assentar, 160);
  });

  return { pulsar, assentar, apagar: () => { cancelAnimationFrame(quadro); canvas.classList.remove('on'); } };
}

// A marca do Nuvo: roseta de seis lóbulos em volta de um miolo, sólida,
// com gradiente e brilho de dentro. Modos: fixa (logo), bloom e pensa (lóbulos
// respirando) e grande (modo voz, girando devagar).
export function marca(tamanho = 44, mini = false, fixa = false) {
  return roseta(tamanho, mini || fixa ? 'fixa' : 'bloom');
}

export function roseta(tamanho = 44, modo = 'fixa') {
  const id = 'r' + Math.random().toString(36).slice(2, 8);
  const lobos = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (-90 + i * 60) * Math.PI / 180;
    const cx = (12 + Math.cos(a) * 4.6).toFixed(2);
    const cy = (12 + Math.sin(a) * 4.6).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="5.2" style="animation-delay:${i * 80}ms"/>`;
  }).join('');
  return `<span class="roseta ${modo}" style="width:${tamanho}px;height:${tamanho}px">
    <svg viewBox="0 0 24 24" width="${tamanho}" height="${tamanho}">
      <defs>
        <linearGradient id="${id}" x1="2" y1="0" x2="22" y2="24" gradientUnits="userSpaceOnUse">
          <stop stop-color="#7aa8ff"/><stop offset="1" stop-color="#3d5cff"/>
        </linearGradient>
        <radialGradient id="b${id}" cx=".5" cy=".2" r=".8">
          <stop stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <g fill="url(#${id})" class="lobos">${lobos}<circle cx="12" cy="12" r="6.8"/></g>
      <g fill="url(#b${id})" style="mix-blend-mode:screen"><circle cx="12" cy="12" r="10.6"/></g>
    </svg></span>`;
}
