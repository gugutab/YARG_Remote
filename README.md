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
| `src/midi.js` | Parser SMF: notas com duração, textos, letras (meta 0x05), SysEx, mapa de tempo. |
| `src/ini.js` | Parser do `song.ini` e leitura do delay. |
| `src/chart.js` | Regras do YARG: instrumentos e modos de bateria, notas especiais, seções, letra, harmonias e percussão. |
| `src/library.js` | Varre a pasta (FSA ou `webkitdirectory`), monta o índice e resolve arquivos. |
| `src/store.js` | Guarda a pasta e o índice no IndexedDB entre visitas. |
| `src/player.js` | Multitrack com alinhamento ao chart, velocidade sem mudar o tom (SoundTouch), volume por stem. |
| `src/highway.js` | Desenho em canvas (notas, sustains, pedais, rolls, vocal com letra). |
| `src/songlist.js` | Busca, filtro (instrumento, gênero) e ordenação da biblioteca. |
| `src/app.js` | Interface, seleção, seções, delays e loop de desenho. |
| `vendor/` | SoundTouchJS (LGPL-2.1), sem build. |
| `scripts/find-special-notes.mjs` | Busca notas especiais num catálogo de MIDIs. |

Para quem vai continuar o projeto, o arquivo `CLAUDE.md` tem o estado atual, as regras do YARG com referências
e as convenções de trabalho.

## Como o `.mid` é interpretado (referências)

Conferido no código do YARG.Core (`github.com/YARC-Official/YARG.Core`, também presente em
`github.com/YARC-Official/YARG/YARG.Core`):

- **Nomes de trilha** — `MoonscraperChartParser/IO/Midi/MidIOHelper.cs`: `PART GUITAR`, `PART BASS`,
  `PART RHYTHM`, `PART KEYS`, `PART DRUMS` (alias `PART DRUM`), `PART VOCALS`, `HARM1-3`, `EVENTS`, `BEAT`.
- **Dificuldade por pitch** — `Song/MidiPreparsers/MidiInstrumentPreparser.cs` (`NOTES_PER_DIFFICULTY = 12`):
  Fácil 60–64, Médio 72–76, Difícil 84–88, Especialista 96–100. Offset 0..4 = lane verde→laranja.
- **Guitarra/baixo** — `Song/MidiPreparsers/MidiFiveFretPreparser.cs`: `FIVEFRET_MIN = 59`; offset 0 é a
  lane verde. Notas de *open* usam o sysex `PS` (`ENHANCED_OPENS`), que este MVP ainda não trata.
- **Bateria** — `Song/MidiPreparsers/MidiDrumsPreparser.cs` e `MidReader.ProcessLists.cs`: 101 = bateria de
  5 lanes (100 = laranja, 101 = verde); 110/111/112 = marcadores de tom para amarelo/azul/verde (pitch 98/99/100): nessas lanes a nota é prato por padrão, e um marcador ativo a transforma em tom,
  da nota-on à nota-off do marcador, em bateria Pro e de 5 lanes. Sem 101 e com 110–112 = Pro; sem nenhum dos dois = 4 lanes.
- **Especiais** — `MidIOHelper.cs`: `103` = solo, `116` = star power, `12`/`13` = compasso/tempo na
  trilha `BEAT`, `105` = frase de letra em vocal.
- **Vocal** — faixa 36–84 são as notas; texto que não começa com `[` é letra.
- **Tempo** — `Chart/Sync/SyncTrack.cs`: mudanças de tempo (meta `0x51`) integradas tick a tick
  (`midi.js` faz o mesmo em `createTickToSeconds`).
- **song.ini** — `IO/Ini/SongIniHandler.cs`: lista de chaves (`name`, `artist`, `song_length`,
  `diff_*`, `delay`…). O MVP lê `name`, `artist`, `album`, `delay`/`delay_seconds` e os valores crus de `diff_*`.
- **Delay** — `SongMetadata.cs` e `SongRunner.cs`: a posição do áudio é `tempo_do_chart + delay`. O player alinha cada
  stem uma vez no carregamento (`alignChannel`, `src/player.js`): delay positivo descarta o início do arquivo, negativo
  põe silêncio na frente.

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

## Limitações

- Só `notes.mid`; arquivos `.chart` não são lidos.
- Guitarra e baixo Pro, teclado Pro e Elite Drums não são desenhados.
- Open pelo modo "enhanced opens" (texto) não é tratado; open pelo SysEx é.
- Fills de bateria, BRE e coda não são desenhados; venue e luzes também não.
- Star power e solo aparecem como faixa de fundo, não por nota.
- Áudio e delays não foram conferidos por ouvido com stems reais.

## Próximos passos sugeridos

1. Conferir a sincronia com stems reais, e o delay do `song.ini`.
2. Guitarra e baixo Pro (`PART REAL_GUITAR`, `PART REAL_BASS`).
3. Arquivos `.chart`.
4. Star power e solo por nota.

## Achar exemplos de notas especiais no catálogo

```bash
node scripts/find-special-notes.mjs <pasta> [--only open,accent,ghost] [--max 5] [--json]
```

Procura `.mid` em todas as subpastas e mostra, por música, instrumento e dificuldade, o tempo e a seção de
cada ocorrência: open, tap, HOPO, accent, ghost, double kick, rolls, percussão e harmonias de vocal, solos e star power.
No fim, um resumo com o total de cada categoria. Sem `--only`, lista todas as categorias.
