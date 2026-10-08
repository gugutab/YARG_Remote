# YARG Remote — visualizador web de músicas

Aponte o navegador para uma pasta de músicas (ex.: `A:\music\Songs\`), veja a lista, escolha
instrumento e dificuldade e toque a música com o chart sincronizado e o volume de cada track
individual. Só visualização: nenhuma detecção de acerto/erro.

## Como rodar

```bash
npm start            # python3 -m http.server 8080 — depois abra http://localhost:8080
npm test             # testes do parser MIDI / song.ini / chart
```

- Use **Chrome ou Edge** (a seleção de pasta usa a File System Access API). Em outros navegadores o
  botão cai no `<input webkitdirectory>`, que funciona mas não mantém a pasta entre sessões.
- A pasta é lida pelo navegador, não por caminho: o botão abre o seletor e você escolhe `A:\music\Songs`.
- Cada música é uma pasta com `song.ini` + `notes.mid` + stems de áudio (`song.ogg`, `guitar.ogg`,
  `drums.ogg`, `vocals.ogg`, `bass.ogg`…). Qualquer `.ogg/.mp3/.opus/.wav/.flac` da pasta vira um track
  no mixer.

## Estrutura

| Arquivo | Responsabilidade |
| --- | --- |
| `src/midi.js` | Parser SMF: trilhas, pares note-on/note-off (duração), letras/eventos de texto, mapa de tempo e conversão tick→segundo. |
| `src/ini.js` | Parser do `song.ini` (seção `[song]`, números viram `number`). |
| `src/chart.js` | Monta o chart de um instrumento/dificuldade: notas com `time`/`length` em segundos, solos, star power, linhas de compasso, seções e letra. |
| `src/library.js` | Varre a pasta (FSA ou `webkitdirectory`) e agrupa em músicas (pasta com `song.ini`/`notes.mid`/`notes.chart`). |
| `src/player.js` | Multitrack com Web Audio: cada stem é decodificado e tocado por um `GainNode` próprio, todos no mesmo relógio do `AudioContext` (sincronia sample-accurate, pause, seek, volume por track). |
| `src/highway.js` | Renderização em canvas em função do tempo de reprodução (seek/pause só mudam o `t`). |
| `src/app.js` | UI: lista, seleção, instrumento/dificuldade, mixer, barra de progresso. |

## Como o `.mid` é interpretado (referências)

Conferido no código do YARG.Core (`github.com/YARC-Official/YARG.Core`, também presente em
`github.com/YARC-Official/YARG/YARG.Core`):

- **Nomes de trilha** — `MoonscraperChartParser/IO/Midi/MidIOHelper.cs`: `PART GUITAR`, `PART BASS`,
  `PART RHYTHM`, `PART KEYS`, `PART DRUMS` (alias `PART DRUM`), `PART VOCALS`, `HARM1-3`, `EVENTS`, `BEAT`.
- **Dificuldade por pitch** — `Song/MidiPreparsers/MidiInstrumentPreparser.cs` (`NOTES_PER_DIFFICULTY = 12`):
  Fácil 60–64, Médio 72–76, Difícil 84–88, Especialista 96–100. Offset 0..4 = lane verde→laranja.
- **Guitarra/baixo** — `Song/MidiPreparsers/MidiFiveFretPreparser.cs`: `FIVEFRET_MIN = 59`; offset 0 é a
  lane verde. Notas de *open* usam o sysex `PS` (`ENHANCED_OPENS`), que este MVP ainda não trata.
- **Bateria** — `Song/MidiPreparsers/MidiDrumsPreparser.cs`: mesma faixa de pitch; 110–112 são flags de
  pratos (bateria Pro), que o MVP ignora. A 5ª lane (101) também não está no MVP.
- **Especiais** — `MidIOHelper.cs`: `103` = solo, `116` = star power, `12`/`13` = compasso/tempo na
  trilha `BEAT`, `105` = frase de letra em vocal.
- **Vocal** — faixa 36–84 são as notas; texto que não começa com `[` é letra.
- **Tempo** — `Chart/Sync/SyncTrack.cs`: mudanças de tempo (meta `0x51`) integradas tick a tick
  (`midi.js` faz o mesmo em `createTickToSeconds`).
- **song.ini** — `IO/Ini/SongIniHandler.cs`: lista de chaves (`name`, `artist`, `song_length`,
  `diff_*`, `delay`…). O MVP lê `name`, `artist`, `album` e os valores crus de `diff_*` ficam disponíveis.

### Verificação com o arquivo de exemplo

Com o `notes.mid` do Aerosmith — "Toys in the Attic" (fora do repositório):

- Trilhas: `notes`, `PART DRUMS`, `PART GUITAR`, `PART BASS`, `PART VOCALS`, `HARM1-3`, `EVENTS`, `BEAT`.
- Duração calculada: 191,43 s (`song_length` do `song.ini`: 191,726 s).
- Bateria Especialista: 531/311/264/196/98 notas por pitch 96–100 — idêntico à contagem bruta.
- Guitarra Especialista: 1000 notas, 154 sustains, 2 solos (103), 13 star power (116), 12 seções.
- Sem `PART RHYTHM`/`PART KEYS` no arquivo: esses instrumentos não aparecem na lista.

## Reaproveitar o YARG Remote atual ou começar do zero?

O repositório `gugutab/YARG_Remote` **está vazio**: a API do GitHub responde `409 Git Repository is empty`,
não há branches e o clone local não tem commits. Não há código a aproveitar, então o projeto começa do zero
nesta branch (`claude/upbeat-knuth-87adga`).

Para o escopo pedido, faz sentido começar do zero mesmo que houvesse código. O YARG em si é um cliente
Unity/C# (pasta `Assets/`) e o parsing vive no YARG.Core em C#, que não roda no navegador. Portar a lógica
de chart (o que este projeto faz em `src/chart.js`) é mais simples do que embutir o cliente inteiro.
O YARG.Core serve como referência de formato, não como dependência.

## Limitações do MVP

- Só `notes.mid`; `notes.chart` (formato .chart) não é lido ainda.
- Sem `open` notes (sysex `PS`), sem Pro Guitar/Keys, sem bateria 5 lanes e sem flags de pratos.
- Vocal é um visualizador de pitch com letra, sem sílabas nem fases.
- `delay` do `song.ini` não é aplicado. Se o áudio estiver deslocado, esse é o primeiro ponto a checar.
- Áudio é decodificado inteiro na memória: um conjunto de stems de 3 min costuma ocupar algumas centenas
  de MB no navegador.
- Não há persistência da pasta escolhida. Ao recarregar a página é preciso escolher de novo.
- Os stems (`guitar.ogg`, `song.ogg`…) entram todos com volume 100%; não há regra automática para evitar
  dobrar o áudio quando `song.ogg` já tem os instrumentos. Ajuste no mixer.

## Próximos passos sugeridos

1. Testar a sincronia de áudio com um conjunto real de stems (o `delay` do `song.ini` entra aqui).
2. Ler `notes.chart`.
3. Sustains com cauda contínua e `open` notes.
4. Persistir o handle da pasta com IndexedDB (`FileSystemDirectoryHandle` é serializável).
