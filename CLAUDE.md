# CLAUDE.md — guia para quem assume o projeto

Este arquivo é a passagem de bastão. Leia inteiro antes de mexer no código. O `README.md` é a visão para o usuário; aqui fica o que você precisa para continuar sem perguntar tudo de novo.

## 1. O que é

Visualizador web (HTML + módulos ES, sem build) de músicas no formato Rock Band / YARG:
- o usuário aponta uma pasta de músicas (`A:\music\Songs\`, ou qualquer pasta), o app lista as músicas;
- ao escolher uma música, ele escolhe instrumento e dificuldade, e toca os stems de áudio com um highway
  sincronizado (notas, sustains, solos, star power, rolls, HOPO, open, bateria, vocal com letra);
- controles: play/pause, seek, seções, volume por stem, velocidade (0,2×–2×) sem mudar o tom, neck speed
  (só espaçamento), delay do chart (−1 s a +1 s), delay do áudio vindo do `song.ini`.
- Não há detecção de acerto/erro. É só visualização.

Idioma: o usuário escreve em **português**. Respostas, README e textos da UI são em português. Comentários
de código e mensagens de commit estão em inglês (padrão já usado).

## 2. Estado atual

- UI redesenhada na branch `claude/ui-redesign` (derivada da abaixo): chart em tela cheia, barra superior com ícones, biblioteca recolhível à esquerda (busca, filtro por instrumento/gênero, ordenação em `src/songlist.js`), ajustes e mixer em popovers. Tela de info da música (abre ao escolher a música, já com o carregamento em andamento; Tocar fica desabilitado até `ready`; tecla I ou botão ⓘ reabre): cartões por instrumento (nível do song.ini, botões de dificuldade próprios e contagens do chart; `renderPickers`), ajustes e mixer (estado compartilhado com os popovers da barra via `settings`/`stemStates`). Barra superior de 2 linhas fixas (92 px): capa nas duas linhas, seekbar como divisor, seção como chip + lista (`#sectionBtn`/`#sectionPop`; o `<select id="sectionSelect">` fica oculto como estado). Instrumento e dificuldade são um chip só (`#partBtn`) que abre uma lista compacta; os `<select id="instrument|difficulty">` ficam ocultos como fonte de verdade. Seletores usam o estilo `.chip-select`/`.chip-btn`. Atalhos: Espaço, I, L, F, [ ], setas. Pasta de testes real do usuário: `A:\music\Songs` (ex.: Guitar Hero\Quickplay, 'Smoke On The Water' em 0:40; 'More Than A Feeling' em 1:00). O compartilhamento 192.16.0.202 não respondeu (porta 445).
- Branch de trabalho anterior: `claude/upbeat-knuth-87adga` (remoto `origin` = `gugutab/YARG_Remote`). Não crie PR sem
  pedido explícito. O remoto também tem `main`, que não é usado.
- 54 testes unitários passando (`npm test`).
- Funciona no Chromium (File System Access API). Em outros navegadores, o `<input webkitdirectory>` é o
  fallback, sem persistência.

Suportado: guitarra, baixo, rhythm, teclado (5 lanes); bateria em 4 lanes, Pro (com marcadores de prato),
5 lanes; vocal solo (`PART VOCALS`) e Harmonia (instrumento próprio: HARM1 lidera, HARM2/3 atrás; letra e percussão caem para `PART VOCALS`), sem dificuldade para vocal; letra, percussão; open (SysEx PhaseShift); tap; HOPO e strum forçado;
accent e ghost; double kick; rolls (tremolo, trill, kick roll); solos e star power (faixas de fundo); seções
(EVENTS); delay do áudio e do chart; velocidade e neck; persistência da pasta e da lista (IndexedDB).

**Não suportado** (pendências, em ordem de valor provável):
- arquivos `.chart` (só `notes.mid`);
- guitarra e baixo Pro (`PART REAL_GUITAR`, `REAL_BASS`) e teclado Pro (`PART REAL_KEYS_*`);
- "enhanced opens" (texto `[ENHANCED_OPENS]`) e open por padrão de nota de 5 lanes;
- notas de fill (120–124) e marcadores de BRE/coda: não são desenhados;
- Elite Drums (`PART ELITE_DRUMS`) e VENUE/luzes;
- star power e solo só como faixa de fundo, não destacando as notas dentro do trecho;
- letra: fases, sílabas com `§`/`=` tratadas só de forma básica; `#`, `+`, `^`, `*`, `%`, `/`, `$` são ocultados
  como no YARG (ver §4).

**Nunca verificado** (só por teste sintético ou leitura de código):
- sincronia de áudio com stems `.ogg` reais e a latência do `PitchShifter`;
- o sinal do delay de áudio e do delay do chart, por ouvido;
- qualidade do time-stretch em velocidades extremas;
- accent e ghost em músicas reais (nenhum dos MIDIs de exemplo tem; ver §6).

## 3. Como rodar e testar

```bash
npm start   # python3 -m http.server 8080; abra http://localhost:8080
npm test    # node --test test/*.test.js (sem navegador)
node scripts/find-special-notes.mjs <pasta> [--only open,accent] [--max 5] [--json]
```

Testes unitários usam MIDIs sintéticos gerados por `test/smf.js` (escritor SMF só para teste). **Não commite
músicas reais do usuário**: elas são protegidas por direitos autorais e ficam fora do repositório.

Verificação visual (feita assim até aqui):
- Chromium do sistema: `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`. Não rode
  `playwright install`. O Playwright vem de `npm root -g`.
- Para carregar uma pasta, use `page.setInputFiles('#folderInput', '<caminho de diretório>')`. O input é
  `webkitdirectory`, então precisa de um diretório real, não de uma lista de arquivos.
- Cada música de teste é uma pasta com `notes.mid`, `song.ini` e um `song.wav` silencioso (o áudio é necessário
  para a música abrir; um WAV de 8 kHz mono de N segundos serve).
- Para posicionar: `#seek` recebe `value` e os eventos `input` e `change`.
- O canvas tem altura `min(70vh, 620px)`. Recorte o screenshot com a altura completa, ou a letra
  (embaixo do canvas) fica de fora.
- Não use `pkill -f <padrão>`: o padrão casa com o próprio shell e derruba a sessão (exit 144). Guarde o PID
  do `http.server` e use `kill`.
- A ferramenta `Read` não lê `.mid` (binário). Para inspecionar, use o parser do projeto (`src/midi.js`) ou um
  script Python com `struct`.

Arquivos de exemplo do usuário (MIDIs enviados, fora do repositório): ficam em
`/root/.claude/uploads/d26c26e2-528c-5e88-b1e8-1ab751f2ced1/`. Os nomes são `<id>-notes.mid`. A identificação
das músicas está no histórico da conversa (ver §6).

## 4. Arquitetura

Fluxo: pasta → `library.js` (músicas) → clique → `midi.js` (parse) + `chart.js` (chart) → `highway.js`
(desenho, função pura de `t`) e `player.js` (áudio). `app.js` liga a UI.

| Arquivo | Papel |
|---|---|
| `index.html`, `styles.css` | UI. IDs dos controles são usados por `app.js`. |
| `server.mjs` | Servidor opcional (`npm start`): app + `/api/library` + `/songs/*`. O app o usa automaticamente (`startLibrary` em `app.js`). Cache do índice em `.cache/`. |
| `src/gfx.js` | Constantes e helpers de desenho compartilhados pelas duas visões. |
| `src/highway3d.js` | Visão 3D da highway (perspectiva no canvas 2D, sem WebGL; vocal usa a visão plana). Botão ⬡ / tecla V; preferência em localStorage. Estilo das notas (círculos ou retângulos arredondados, `noteShape` em `gfx.js`): botão abaixo do 3D / tecla N, também em localStorage. |
| (bateria) | Modo "Bateria (Pro 7 lanes)" (id `drums-extended`): 7 lanes, tambor e prato cada um na sua (`EXTENDED_DRUM_LANES` em `chart.js`). No YARG isso é por perfil (Split/Merge em `DrumsHighwaySpecs.cs`); a ordem exata após o split não foi confirmada. Pratos são triângulos. |
| `src/songinfo.js` | Dados da tela de info: metadados e níveis do `song.ini`, BPM e contagens do chart (funções puras). |
| `src/songlist.js` | Busca, filtro e ordenação da lista (funções puras). |
| `src/app.js` | Eventos, seleção de música/instrumento/dificuldade, loop `frame()` (relógio, seção, highway). |
| `src/midi.js` | Parser SMF: notas com `tick`/`endTick`/`velocity`, `texts` (meta 0x01), `lyrics` (meta 0x05), `sysex` (F0), `tempos`; `toSeconds` converte tick em segundos. |
| `src/chart.js` | Regras do YARG (ver §5). Exporta `instrumentOptions`, `buildChart`, `availableDifficulties`, `phraseWindows`, `naturalHopo`, `parseSectionName`, `sectionIndexAt`, `displayLyric`, `drumKind`. |
| `src/highway.js` | Desenho em canvas. `render(t)` não guarda estado de tempo. Ordem de desenho importa: hit line → pedais/open → sustains → cabeças. Constantes de visual no topo. |
| `src/player.js` | `MultiTrackPlayer`: stems em `AudioBuffer`, alinhados ao chart (`alignChannel`) e tocados por `PitchShifter` (SoundTouch, `vendor/`). Velocidade via `tempo`. |
| `src/library.js` | Varredura de pastas (FSA ou input), índice serializável, `resolveFile`. |
| `src/store.js` | IndexedDB: handle da pasta e índice. Falhas são silenciosas. |
| `src/ini.js` | `song.ini` e `songDelaySeconds` (`delay` em ms ou `delay_seconds`). |
| `vendor/` | SoundTouchJS 0.1.30 (LGPL-2.1), sem build. Licença junto. |
| `test/` | Testes `node:test`. `smf.js` escreve MIDIs sintéticos. |
| `scripts/find-special-notes.mjs` | Busca de notas especiais num catálogo, com tempo e seção. |

Modelo de dados do chart (`buildChart`):
- `mode`: `'lanes'` (guitarra, baixo, rhythm, keys, bateria) ou `'vocals'`.
- lanes: `notes[] = {time, end, length, lane, cymbal, tap, hopo, open, accent, ghost, doubleKick}`, `lanes`,
  `laneColors`, `drumKind`, `rolls[]`, `solos[]`, `starPower[]`, `beats[]`, `sections[]`, `duration`.
  Na bateria, `lane = -1` é o kick (barra de largura total, não coluna).
- vocals: `notes[] = {time, end, length, pitch}`, `harmonies[] = {part, notes}`, `percussion[] = {time, played}`,
  `lyrics[] = {time, text}`.

Relógio: `player.currentTime()` = posição do chart. A highway recebe `t − chartDelay`, então um delay positivo
faz as notas chegarem depois do áudio. A seção atual usa o mesmo tempo da highway.

## 5. Regras do YARG (fonte: `yarg.core` em `github.com/YARC-Official/YARG.Core`)

Clone de referência usado: `/home/user/yarc-official/yarg.core` (pode não existir na nova sessão; clone com
`GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/YARC-Official/yarg.core`).

| Tema | Regra | Onde no YARG.Core |
|---|---|---|
| Dificuldades | Base 60/72/84/96 (Fácil/Médio/Difícil/Especialista). Offsets 0–4 = lanes; +5 e +6 = forçado HOPO e forçado strum. | `MidiInstrumentPreparser.cs`, `MidiFiveFretPreparser.cs` |
| Tap | Nota 104 marca janela `[start, end)`; notas dentro são tap (todas as dificuldades). | `MidReader.ProcessLists.cs` |
| HOPO natural | Não é acorde, tem nota anterior (outro traste ou acorde) e distância ≤ `resolução/3 + 1`. | `MoonNote.IsNaturalHopo`, `MidReader.cs` |
| Forçado | Janela de 101 força HOPO; 102 força strum. Strum vence HOPO. | `MidReader.cs` (`ProcessEventAsGuitarForcedTypePostDelay`) |
| Open | SysEx `PS\0`, tipo 0, dificuldade (0–3, 0xFF = todas), código 1 = open, valor 1 início / 0 fim, F7. Notas na janela viram open. | `PhaseShiftSysEx.cs`, `MidReader.cs` |
| Sustain | Nota tem sustain se dura ≥ `resolução/3` ticks. Bateria não tem sustain. | `SustainCutoffThreshold` em `MidReader.cs` |
| Bateria: tipo | 101 presente = 5 lanes; 110–112 presentes = Pro; senão 4 lanes. | `MidiDrumsPreparser.cs` |
| Bateria: pads | Offsets 0 kick, 1 vermelho, 2 amarelo, 3 azul, 4 laranja (5 lanes) ou verde (4 lanes), 5 verde (5 lanes). | `DrumPadToMidiKey` em `MidReader.ProcessLists.cs` |
| Prato (Pro) | Amarelo, azul e laranja/verde são **prato por padrão**. Notas 110/111/112 são **marcadores de tom**: a janela de cada uma faz XOR. Prato = número par de marcadores cobrindo a nota. | `DrumPadDefaultFlags`, `PAD_TO_CYMBAL_LOOKUP` em `MidIOHelper.cs`, `ProcessNoteOnEventAsFlagToggle` (`note.flags ^= flags`) |
| Modo 4 lanes do Pro | Mesmas notas, sem prato. A opção aparece como "Bateria (4 lanes)". Nos seletores (cartões e menu superior) as baterias são um item só, "Bateria", com seletor de modo (4 lanes / 5 lanes / Pro / Pro 7 lanes); `instrumentGroups()` em `app.js` (vocal e harmonia também são um item "Vocal" com seletor). | `MoonNoteToFourLane` |
| Accent / ghost | Velocity 127 = accent, 1 = ghost, só em pads (não kick). | `MidIOHelper.VELOCITY_ACCENT/GHOST` |
| Double kick | Nota uma abaixo do kick da dificuldade (95 no Especialista) vira um kick próprio, no seu tick, com o flag. | `MidReader.ProcessLists.cs` (`key - 1` com `InstrumentPlus`) |
| Rolls | 125 kick roll, 126 tremolo, 127 trill (faixas de tempo). | `MidIOHelper.cs` |
| Seções | Texto na trilha `EVENTS` como `[section Nome]` ou `prc_nome`. Seção atual = última iniciada; antes da primeira, a primeira. | `TextEvents.TryParseSectionEvent`, `PracticeManager.FindSectionAtTime` |
| Letra | Eventos de lyric (meta 0x05) na trilha de vocal; se não houver, texto sem colchetes (ex.: `5395826e`, `5875318f`). | `MidReader.cs`, `LyricSymbols.cs` |
| Símbolos da letra | Ocultos: `+ # ^ * % / $`. `=` = hífen. `§` = sílabas unidas (`‿`). `-` fica. | `LyricSymbols.cs` |
| Vocal | Notas 36–84 (0 e 1 são deslocamentos de faixa; 96 tocado e 97 não tocado são percussão). Harmonias: `HARM1`–`HARM3` ou `PART HARM1`–`HARM3`. | `MidIOHelper.cs` |
| Delay | `delay` (ms) se ≠ 0, senão `delay_seconds`. Posição do arquivo = tempo do chart + delay. | `SongMetadata.cs`, `SongRunner.cs` |
| Tempo | Mapa de tempo somado de todas as trilhas (meta 0x51), `tick → segundos` integrado. | `SyncTrack.cs` |

## 6. Músicas de exemplo do usuário

Identificadas pela letra, pelo nome da trilha e pelas seções (confiança diferente):
- `5395826e` — **Highway Star** (Deep Purple). Letra confirmada. Harmonias não. Percussão em 120 s (`chorus_2`/`organ_solo_a`). Letra em 43 s.
- `5875318f` — **Before I Forget** (Slipknot), provável. Harmonias HARM1/2 (H2 com notas próprias em ~50 s). Letra em 39 s. Double kick em 33 s.
- `01b7a7a6` — **No One Like You** (Scorpions). Confirmado pelo usuário. Harmonias H1/H2/H3 em 39 s, 68 s, 73 s. Letra em ~40 s.
- `b96f00af` — **Toys in the Attic** (Aerosmith). Confirmado pelo usuário. Harmonias H1/H2 em 23 s, H3 em 148 s. Percussão em 108 s.
- `34e01570` — **Panic Attack** (Dream Theater), provável (trilha `panicattack`). Percussão em 135 s. Pouca letra.
- `cb619a04` — **não identificada**. Open no baixo Especialista a partir de 11,7 s. Letra abundante.
- `38a7b2e3` — **não identificada**. Sem letra. Seções Scream, Ballad Of Metal.

Achados de teste: nenhum dos seis tem accent ou ghost em pad. Tap (104) também não aparece. Double kick
aparece em `5875318f` e `34e01570`. Rolls em `5395826e`. Para testar accent/ghost, gere MIDI sintético.

## 7. Convenções de trabalho

- Commits: mensagem em inglês, com trailers
  `Co-Authored-By: Claude <noreply@anthropic.com>` e
  `Claude-Session: https://claude.ai/code/session_01CyeWZRtgcvqEJkCGi1jXRk`. **Não** coloque nome ou versão
  de modelo em commits, PRs ou arquivos do repositório.
- Identidade do git: use `git -c user.name=... -c user.email=...` com `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` se
  definidos, senão `gugutab`.
- Push sempre com `git push -u origin claude/upbeat-knuth-87adga`. Não faça push em outra branch, nem force-push.
- Antes de cada commit: `npm test` e `node --check` nos arquivos alterados.
- Mudanças visuais: confira com screenshot (ver §3). Teste de unidade não basta para desenho.
- Para regras de MIDI, cite a origem no YARG.Core (arquivo e função) no comentário, como já é feito.
- Arquivos podem mudar no disco entre os turnos (o usuário edita). Antes de editar, releia o trecho.
- Ferramentas: `Edit` exige que o arquivo tenha sido lido na conversa. Se der "No changes to make", o texto já
  está correto.

## 8. Pontos de atenção

- Áudio: `player.js` usa um `AudioWorklet` (`player-worklet.js` + `mixstretch.js`) que mistura todas as stems e aplica o time-stretch (SoundTouch) uma vez, com uma só posição de leitura; o relógio do chart interpola o histórico de posições que o worklet reporta (`clock.js`), no instante `ctx.currentTime − latência de saída` (extrapolar com a velocidade atual causava saltos ao trocar de velocidade; relatórios chegam à frente do que é ouvido, e `epoch` descarta relatórios anteriores a um seek). Isso corrigiu a perda de sincronia entre stems e chart do motor antigo (um `ScriptProcessor` por stem na thread principal, ainda presente como `LegacyPlayer` de fallback). Teste do núcleo: `test/mixstretch.test.js`. Não verificado de ouvido: qualidade do stretch e latência real em aparelhos.
  trabalho próprio. Ele adiciona latência; o relógio da highway não compensa isso.
- `showDirectoryPicker` mostra um diálogo nativo do Chrome; a página não consegue suprimi-lo. "Reabrir pasta"
  pede só a permissão de leitura, num clique.
- A letra e as seções usam o mesmo `t` da highway, com delay do chart aplicado. Mudar um deles sem o outro
  quebra o alinhamento.
- Bateria Pro: como quase todo pad é prato por padrão, a tela mostra muitos anéis. É o comportamento do YARG.
- `sectionIndexAt` devolve a primeira seção antes de qualquer início. Não use `-1` para "sem seção" se houver
  seções.
- Star power: faixa de fundo + notas da frase em branco com contorno da lane (como o YARG; `markStarPowerNotes`). Solo continua só como faixa de fundo. A comparação com o render do YARG e as sugestões estão em `docs/yarg-render-review.md`.
- O modo de 5 lanes aplica prato (flags) também. O usuário pediu isso explicitamente; não o remova sem pedir.
