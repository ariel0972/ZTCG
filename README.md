# ZTCG — Zacornia Trading Card Game

Jogo de cartas com contas, construção de baralhos, partidas públicas e por convite, amizades e perfis. Express e TypeScript executam as regras; MongoDB persiste fila, partidas e resultados. O navegador usa HTTP para comandos e SSE para atualizações privadas, com consulta HTTP de recuperação.

O [GUIA_DO_PROJETO.txt](GUIA_DO_PROJETO.txt) explica **cada arquivo**, as mecânicas utilizadas, os problemas restantes, prioridades e como implementar mudanças. É a referência consolidada; os relatórios históricos em Markdown foram removidos.

## Executar

Requisitos: Node.js 22.16 ou superior compatível com o lockfile, npm e MongoDB.

```powershell
npm ci
# Apenas se .env ainda não existir:
Copy-Item .env.example .env
# Configure MONGO_URL e um SECRET aleatório com pelo menos 32 caracteres.
npm run check
npm run dev
```

Abra `http://localhost:3000`. Em produção Node, use `npm run build` e `npm start`. A configuração existente de Vercel usa `src/server.ts`; detalhes operacionais e limites estão no guia.

Para experimentar com contas fictícias e sem conectar ao banco:

```powershell
npm run demo
```

Abra `http://127.0.0.1:3187`. Contas `p1@test.local`, `p2@test.local`, `p3@test.local`, senha `teste-ztcg-123`; a terceira é administradora. A prévia perde os dados ao encerrar e deve permanecer local.

## Fluxo e regras atuais

- Sem login, é possível montar, importar e exportar rascunhos locais. Com login, salve os decks na conta e entre na fila ou aceite um convite de amigo.
- Deck jogável: 40 cartas publicadas e executáveis, mais um mago; até três cópias de tropas/feitiços e duas de estruturas/armamentos. Rascunhos incompletos podem ser salvos.
- Preparação simultânea: cinco cartas e cinco de mana por jogador; mobilização de tropas gratuita, manual e limitada pelo mago. Cada jogador confirma quando quiser; compras opcionais de reembaralhamento também precisam ser resolvidas.
- Ataques, habilidades e dano ficam bloqueados na preparação **e nos dois primeiros turnos de combate**, um de cada jogador. Essa é a decisão mais recente, já aplicada no motor. Mobilização e feitiços sem dano seguem seus limites.
- Após atacar, não se mobilizam mais tropas nesse turno. Habilidade: uma por carta por rodada. Limites de feitiços comuns e assinaturas são separados. Mana máxima: 20.
- Feitiços 001–010, Lágrima de Zarcos e Fluxo Forte, reações elementais e passivas reutilizáveis estão implementados. Jato d’água permite resposta de 20 segundos, persistida, a feitiços comuns de Fogo dirigidos a tropas/magos; o relógio normal fica pausado.
- Turno/preparação: 120 segundos. Três turnos consecutivos sem ação válida causam derrota. Desconexão: após 15 segundos sem presença, há 90 segundos de tolerância. A fila e os convites expiram em cinco minutos.
- Resultados são persistidos e reconhecidos individualmente. Revanche exige os dois jogadores. Perfis mostram estatísticas do histórico completo e apenas os decks que o dono publicou.

O catálogo local tem 130 definições, 44 publicadas nesta revisão. `npm run audit` informa as quantidades atuais; registros válidos do banco prevalecem sobre a definição local. Publicação técnica não comprova fidelidade à arte nem balanceamento.

## Administração e qualidade

```powershell
npm run admin -- seu-email@exemplo.com
npm run audit
npm run check
```

O primeiro comando concede administração à conta existente no MongoDB configurado. O painel `/HTML/admin.html` edita JSON declarativo, valida e salva cartas com controle de versão. Descrição não executa regras. Consulte os exemplos e o roteiro de publicação no guia.

Passivas novas combinam `gatilho`, `escopo`, filtros/condições e uma lista de `efeitos`. Há eventos de ataque, cura, morte, abate e destruição de estrutura, além de condições de percentual de vida. O guia traz exemplos para criar outras cartas pelo JSON; `legacy-passives.ts` mantém compatibilidade com definições antigas. Passivas e habilidades geram avisos no jogo, e bloqueios de ataque são avisados somente a quem tenta atacar.

`npm run check` verifica tipos, testa regras/API/interface/arquitetura e compila. `npm run audit` não conecta ao banco: verifica publicação local, imports, alcance dos módulos, arquivos estáticos e cobertura do guia. A integração real do MongoDB é opcional e exige um banco temporário novo `ztcg_test_*`.

`npm run format` formata fontes, testes, scripts e interface. Credenciais, backups, logs, dependências e `dist/` são ignorados pelo Git. Atualizações no banco, backups reais e alterações de regras/aparência exigem sua definição ou autorização específica.

## Organização

- `src/game/engine.ts`: aplicação atômica das regras; `state.ts`: contratos de estado; `capabilities.ts`: validação do conteúdo publicável; `status.ts`, `reactions.ts`, `passives.ts`: regras auxiliares.
- `src/game/durable.ts` e `store.ts`: coordenação e armazenamento compartilhado. `src/routes/gameRoutes.ts`: comandos HTTP e canal SSE autenticado.
- `src/routes`, `services`, `middlewares`, `db/models`: APIs, consultas, autenticação, autorização e documentos persistidos.
- `public/HTML`, `public/JS`, `public/CSS`: páginas e módulos realmente carregados pelo navegador. As artes originais ficam preservadas em `public/assets`.

Deploy e backup no GitHub Actions têm acionamento manual; verificações rodam em push/PR. O cron de manutenção na Vercel conserva a configuração existente. O guia diferencia infraestrutura preparada, verificações históricas e o que ainda precisa de homologação.
