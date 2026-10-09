# Revisão: como o YARG renderiza × o que fazemos

Fonte: código do YARG (`github.com/YARC-Official/YARG`, branch `master`, pastas `Assets/Script/Gameplay/Visuals` e
`Player`) e do YARG.Core (`Game/Presets`). A leitura foi feita por subagentes que resumem as páginas, então os valores
abaixo vêm de extração e **devem ser conferidos antes de virarem requisito**. O que não apareceu nos arquivos lidos está
marcado como **não confirmado**. A wiki (`wiki.yarg.in`) não traz números de nota nem detalhes de render.

## 1. O que o YARG faz (confirmado nos arquivos lidos)

**Highway (guitarra/baixo/teclado)**
- Pista com largura 2, strike line em z = −2, notas nascem em z ≈ 5 (cerca de 7 unidades de pista à frente). Lanes de 5
  posições: x = −0,8; −0,4; 0; 0,4; 0,8 (`TrackPlayer`, `TrackElement`).
- Câmera padrão (YARG.Core `CameraPreset`): FOV 55, Y 2,66, Z 1,14 (−6 na câmera), rotação 24,12°, fade 1,25.
  Outros presets: Circular, High FOV, Hero 2 (FOV 58, rot 12°), "Kinda Orthogonal" (câmera alta, fade 0).
- Cores padrão (`ColorProfile.Defaults`): verde `#79D304`, vermelho `#FF1D23`, amarelo `#FFE900`, azul `#00BFFF`,
  laranja `#FF8400`, roxo (open) `#C800FF`; notas de star power `#FFFFFF`; erro `#909090`.
- Tipos de nota de guitarra: strum, HOPO, tap, open, open HOPO, wildcard; cada um tem seu modelo, e há um modelo
  de star power. Notas dentro de uma frase de star power usam a cor de star power.
- Sustain: largura 0,1 (5% da pista, ~25% de uma lane); ao ser segurado encolhe em direção à strike line e brilha
  (emissão ×3); errado vira cinza.
- Linhas de compasso/batida em três níveis: compasso (altura 0,07, alpha 0,6), batida forte (0,05, 0,4) e fraca
  (0,03, 0,3).
- Efeitos de trilha: solo, unison (star power), fill de bateria, BRE, e combinações.
- Frets (botões da strike line): fade de 0,25 s, cor inativa cinza.

**Bateria**
- Tipos de nota separados: normal, prato, kick, accent, ghost, prato accent, prato ghost, wildcard, kick de lane
  dedicada. Accent e ghost são **grupos de modelos próprios**, não só mudança de cor.
- Kick centralizado quando não há lane dedicada; kick duplo com cor própria (`DOUBLE_KICK_FRET_INDEX`).
- Fills: o fill é associado ao acorde ativador (nota de star power) logo depois; fills sem ativador são removidos.
  A nota ativador pulsa quando a ativação é possível.
- BRE/coda: lanes brilham e esmaecem a partir da última batida.

**Vocal**
- Faixa de tons ajustada ao que vem pela frente: ao menos 20 semitons, 10% de folga, transição suave (mín. 0,25 s).
- Cores de letra (frase estática): passado `#595959`, presente `#13F0A6`, futuro branco; com star power, futuro
  `#FFEB04` e passado `#757519`.
- Harmonia: até 3 faixas de letra; cada parte tem cor própria e leve deslocamento de profundidade; notas não
  afinadas (talkie) são semitransparentes (alpha 0,2); percussão é um objeto que gira ao aparecer.

## 2. Já aplicado nesta rodada

| Mudança | Onde |
|---|---|
| Paleta de guitarra e open iguais ao YARG | `src/gfx.js`, `src/chart.js` |
| Notas dentro de star power em branco, com contorno na cor da lane (2D e 3D) | `markStarPowerNotes` em `src/highway.js` |
| Faixa de tons do vocal ajustada às próximas notas (mín. 20 semitons, 10% de folga, suavizada) | `vocalRange` |
| Letra: passado cinza, presente verde-água, futuro branco | `renderVocals` |
| `devicePixelRatio` limitado a 2 (celulares reportam 3+) | `Highway.resize` |

## 3. Sugestões (por valor estimado)

**Fidelidade visual**
1. **Linhas de batida em três níveis**: hoje só há compasso e batida, e com alpha baixo. Acrescentar a linha fraca
   (meia batida) e subir os alphas para 0,6/0,4/0,3.
2. **Fills de bateria (notas 120–124)** e a nota ativador: hoje não são desenhados. Mostrar a faixa do fill e destacar
   a nota ativador. É o maior item visual que falta na bateria. O mapeamento exato 120–124 não foi confirmado.
3. **Accent e ghost**: o YARG usa modelos distintos; nós usamos contorno grosso e transparência. Avaliar um destaque
   mais forte (ex.: anel duplo para accent).
4. **Vocal não afinado (talkie)**: letras terminadas em `#`/`^` devem ter barra semitransparente (alpha 0,2).
5. **Star power no vocal**: frases de star power (nota 116) deixam a letra em amarelo.
6. **Alcance de tons pelo MIDI**: o YARG usa os eventos de mudança de alcance; nossa versão apenas se ajusta às notas
   que vêm pela frente. Ler os eventos reduz saltos de enquadramento.
7. **Letra de harmonia em até 3 linhas** (uma por parte) em vez de uma só.
8. **BRE/coda**: lanes brilhando; marcador de coda na linha do tempo.

**3D**
9. A razão entre o tamanho da pista no fundo e na strike line, calculada a partir da câmera padrão (FOV 55, rotação
   24°), dá cerca de **0,37**; usamos 0,30. Vale testar `FAR_SCALE = 0.37` e comparar. Cálculo nosso, não valor do código.
10. Duração do brilho do botão ao acertar: o YARG usa 0,25 s; usamos 0,14 s.
11. Sustain segurado com brilho (emissão ×3) e fret inativo em cinza.

**Desempenho em celulares**
12. Desenhar o fundo estático da pista (faixas, divisores) uma vez em um canvas fora da tela e só copiar a cada quadro.
13. Evitar criar o gradiente do fade a cada quadro; guardar por altura.
14. Limitar a taxa de quadros (30 fps) em aparelhos lentos ou com bateria baixa.
15. O YARG usa pool de objetos e faz as barras de pista em shader; nosso desenho é imediato e já roda a mais de 100
    fps em headless, mas o teste em aparelho real está pendente.

**Dados / correção**
16. O alcance de tons do vocal vai até a nota 84; a wiki define C2–B5, ou seja, 36–83. Conferir se a nota 84 deve ser
    ignorada.
17. Cores da bateria e das harmonias: os valores do `ColorProfile` não foram lidos; nossas cores de bateria seguem a
    convenção do Rock Band, sem confirmação do YARG.

## 4. Não confirmado

Valor padrão de `NoteSpeed`; curva e direção do fade (shader); aparência da strike line; malhas das notas; ordem e
cores dos pads de bateria; mapeamento 120–124 para fills; visual de rolls (125–127); caixa de solo; geometria da barra
do kick; cores de harmonia. Para fechar essas lacunas, o caminho é abrir os prefabs e o shader do YARG no Unity ou
comparar com capturas de tela do jogo.
