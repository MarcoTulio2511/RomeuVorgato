# Pierre Casa

Controle financeiro pessoal **e do casal**: cada pessoa mantém suas contas, cartões, receitas e despesas; a casa enxerga o conjunto sem duplicar nada. O **Pierre** é um assistente 100% determinístico (regras, sem IA, sem chamadas externas).

Stack: React 19 · TypeScript (strict) · Vite · Styled Components · React Router · Supabase (Auth + PostgreSQL) · Recharts · Vitest + Testing Library · `papaparse` (CSV) · `ofx-js` (OFX).

> **Estado:** o front-end e o banco estão implementados e testados (veja “Verificações”). **O app só funciona de ponta a ponta depois que você conectar um projeto Supabase seu** — sem as chaves ele mostra uma tela de configuração e não simula conexão.

---

## 1. Rodando localmente

```bash
npm install
cp .env.example .env.local      # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev
```

Scripts: `npm run dev` · `build` · `preview` · `typecheck` · `lint` · `format` · `test` · `test:rls`.

## 2. Configurando o Supabase

1. Crie um projeto em <https://supabase.com> (ou rode local com a [Supabase CLI](https://supabase.com/docs/guides/local-development): `supabase start`).
2. **Aplique as migrations** de `supabase/migrations` em ordem (CLI: `supabase link --project-ref <ref>` e `supabase db push`; ou cole cada arquivo no SQL Editor, na ordem do nome):
   1. `…000001_core_households_auth.sql` — casas, membros, convites, preferências, idempotência
   2. `…000002_finance_schema.sql` — contas, cartões, categorias, lançamentos, faturas, parcelas, orçamentos, recorrências, importação, Pierre, auditoria
   3. `…000003_finance_rpcs.sql` — operações atômicas (lançar, transferir, parcelar, pagar fatura, estornar…)
   4. `…000004_planning_imports_rpcs.sql` — materialização de recorrências e importação atômica
   5. `…000005_rls_policies_grants.sql` — RLS e permissões por coluna
3. **Auth → URL Configuration:** adicione `http://localhost:5173` (e o domínio de produção) em *Site URL* / *Redirect URLs* — necessário para recuperação de senha e confirmação de e-mail (`/redefinir-senha`, `/entrar`).
4. **Auth → Providers → Email:** habilite e-mail/senha. Recomendado: manter “Confirm email” ligado em produção (o app trata os dois casos) e senha mínima de 8 caracteres.
5. Copie **Project URL** e a chave **anon/publishable** para `.env.local`. **Nunca** coloque a `service_role` no front-end.
6. (Opcional, só desenvolvimento) `supabase/seed.sql` cria dados de exemplo marcados com `[DEV]` na primeira casa existente.

### Criando os dois usuários
1. Pessoa A: *Criar conta* → e-mail/senha → **Criar uma casa** (vira administradora).
2. Pessoa A: *Configurações → Casa e membros → Gerar convite*. O link (`/convite#t=…`) e o código aparecem **uma única vez** (só o hash SHA‑256 fica no banco; expira em 7 dias; uso único).
3. Pessoa B: *Criar conta* → **Entrar com convite** (o link já preenche o código). O limite é de **2 membros ativos** por casa, imposto por trigger com lock (sem condição de corrida).

### Variáveis de ambiente

| Variável | Onde | Observação |
|---|---|---|
| `VITE_SUPABASE_URL` | front-end | pública |
| `VITE_SUPABASE_ANON_KEY` | front-end | chave pública (anon/publishable); a segurança vem da RLS |
| `RLS_SUPABASE_URL`, `RLS_SUPABASE_ANON_KEY`, `RLS_SUPABASE_SERVICE_ROLE_KEY` | só `npm run test:rls` | **projeto de teste**; a service_role cria/remove usuários de teste e nunca entra no bundle |

## 3. Papéis e permissões

| Ação | Admin | Membro |
|---|---|---|
| Ver todos os dados da casa (contas, cartões, lançamentos…) | ✔ | ✔ |
| Criar/editar/excluir **as próprias** contas e cartões | ✔ | ✔ |
| Lançar em conta/cartão **de outra pessoa** | ✘ | ✘ |
| Categorias, orçamentos (compartilhados ou pessoais) | ✔ | ✔ |
| Gerar/revogar convites, remover membro, editar nome/meta da casa | ✔ | ✘ |
| Alterar o próprio papel ou a associação à casa | ✘ (só por RPC no servidor) | ✘ |

Princípios: RLS em **todas** as tabelas · `anon` sem acesso · `INSERT/UPDATE/DELETE` em `transactions` e demais tabelas atômicas **negados ao cliente** (só RPC `SECURITY DEFINER`, que valida `auth.uid()` e associação à casa) · `GRANT` por coluna (cliente não toca `household_id`, `owner_id`, `role`, `status` de previsto) · **FKs compostas** `(household_id, id)` impedem referência entre casas até para superusuário · tokens de convite com 244 bits, só o hash armazenado, mesma mensagem de erro para inexistente/expirado/usado · mensagens de erro sem detalhes técnicos · nenhum arquivo de extrato é enviado ao servidor.

## 4. Regras financeiras (documentadas)

* **Valores** sempre em centavos inteiros (cliente e `bigint`); formatação `Intl.NumberFormat('pt-BR')` só na exibição. Divisão de parcelas: cada parcela recebe `floor(total/n)` e os centavos restantes vão, um a um, para as primeiras parcelas — soma exata (também verificada por *constraint trigger* diferido no banco).
* **Saldo da conta** = saldo inicial (válido no *início* da data‑base) + receitas + estornos + transferências recebidas + ajustes(+) − despesas − transferências enviadas − pagamentos de fatura − ajustes(−). Movimentos anteriores à data‑base **não** alteram o saldo. Só lançamentos `posted`.
* **Cartão:** compra/estorno/encargo gera obrigação na fatura do ciclo e **não** mexe no saldo. Pagar a fatura debita a conta e abate a fatura (**não** cria nova despesa); pagamento parcial não quita (estado “paga parcialmente”). Total = compras + encargos − estornos; a fatura **não** guarda total (view `v_card_invoices` + domínio calculam, sem duplicidade).
* **Ciclo:** fechamento = `closing_day` (limitado ao último dia do mês); vencimento = primeiro `due_day` **depois** do fechamento. **Compra no dia do fechamento**: configurável por cartão — `next` (padrão: vai para a fatura seguinte) ou `current`. Mudar os dias do cartão só afeta faturas **futuras**.
* **Limite disponível** = limite − Σ saldo em aberto das faturas (inclui parcelas futuras) − compras pendentes. Pagamentos não são subtraídos duas vezes; saldo credor não cria limite extra.
* **Parcelamentos:** a parcela *n* cai no ciclo da 1ª deslocado em *n−1* fechamentos; data de competência = data da compra + (n−1) meses (limitada ao fim do mês). Relatórios têm **política explícita**: *parcela a parcela* (padrão) ou *total na data da compra* — nunca os dois.
* **Orçamentos:** usado = gastos líquidos da categoria **e subcategorias** no mês (estornos descontam; transferências, pagamento de fatura e ajustes não contam). Base *competência* (data da compra/parcela) ou *vencimento da fatura*. Pessoal conta só o titular; compartilhado conta todos. Limite por pedido: mostra pedidos “cheios” **e a sobra** (não só divisão inteira).
* **Dinheiro livre até a data H** = saldo (contas ativas da visão conjunta) + receitas **confirmadas** previstas − faturas em aberto que vencem até H − despesas previstas até H. Receitas estimadas aparecem à parte (“com estimadas”). Previsto efetivado (status `realized`/lançamento vinculado) **sai** da conta para não contar em dobro. Sem despesas previstas cadastradas, o resultado é marcado como **estimativa incompleta**. H padrão = próxima renda principal prevista (senão, fim do mês).
* **Recorrências:** âncora na primeira data (dia 31 → 28/29/30 nos meses curtos, sem “derivar”); fim de semana: manter / dia útil anterior / seguinte (**feriados não são considerados**). A rotina `materialize_recurring` só gera **previsões** (idempotente por chave `regra:data`, lock por regra, sem backfill do passado) — lançamentos reais só nascem quando você confirma “Paguei/Recebi”.
* **Visão conjunta:** despesa compartilhada é **uma** linha (não duplica); transferência interna não é receita/despesa; cartões nunca somam ao saldo bancário.

## 5. Importação (CSV / OFX)

Fluxo: destino (sua conta/cartão) → arquivo → validação (tamanho ≤ 5 MB, extensão **e conteúdo**, binário/`<script>` rejeitados, UTF‑8 estrito com *fallback* Windows‑1252) → mapeamento (delimitador, cabeçalho, colunas data/descrição/valor/débito/crédito/tipo/ID, formato de data e de valor) → prévia no servidor com duplicatas → revisão (incluir, categoria, descrição) → confirmação **atômica** → histórico (com “desfazer”).

Duplicatas, em ordem: (1) identificador estável (`FITID`/ID externo) → “duplicada”; (2) assinatura normalizada (data, sentido, valor, descrição sem acento/pontuação, com contador `#n` de ocorrência) → “revisar”; (3) lançamento parecido (mesma data e valor) → “revisar”. Nada é descartado em silêncio: o usuário decide. Reimportar o mesmo arquivo avisa e marca as repetidas.

Limitações: não há layout por banco (o mapeamento é manual); OFX só bancário/cartão em BRL (sem investimentos, sem multimoeda); `1.234` sem decimais é lido como milhar (formato BR) a menos que você escolha o formato americano; máximo de 5.000 linhas por lote.

## 6. Pierre (regras determinísticas)

Orçamento saudável/perto do limite/excedido/ritmo alto · próxima fatura / fatura vencida · renda próxima · gasto acima do padrão (exige `N` meses completos configuráveis) · assinatura próxima · compromissos > dinheiro livre · meta de economia atingida/em risco · oportunidade de compra (limite por pedido). Prioridades, **um tópico por situação** (sem mensagens contraditórias), supressão de mensagens “positivas” quando falta caixa, período de espera por severidade, dispensar/adiar persistidos em `pierre_messages`. Perguntas prontas (“Posso pedir iFood hoje?”, “Quanto ainda posso gastar?”…) respondem com **a regra, os valores e os compromissos considerados**.

## 7. Testes e verificações

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

* `tests/unit` — dinheiro, datas, recorrência, saldos, faturas, parcelas, orçamentos, dinheiro livre, importação, Pierre, formulários/estados de interface.
* `tests/integration/couple-scenario` — cenário do casal com valores calculados à mão.
* `tests/integration/db` — rodam as **migrations reais** num Postgres WASM (PGlite) com um *shim* do schema `auth`: RLS negativa entre casas, convites, limite de membros, atomicidade, idempotência, parcelas, fatura/pagamento, importação (inclusive *rollback* parcial), recorrência e **paridade SQL × TypeScript** (ciclo de fatura e recorrência).
* `npm run test:rls` — mesmos cenários de isolamento contra um Supabase **real** (precisa das variáveis `RLS_*`; ignorado caso contrário).

## 8. Publicação

**Vercel:** em *Project Settings → Environment Variables* crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (marque **Production** e **Preview**) e faça um **novo deploy** — variáveis `VITE_*` são embutidas no momento do build; o `.env.local` não vai para o Git nem para a Vercel. O `vercel.json` já traz o fallback de SPA e cabeçalhos de segurança. Depois, inclua a URL do deploy em *Authentication → URL Configuration* no Supabase (Site URL e Redirect URLs).

`npm run build` gera `dist/` (estático). Hospede em qualquer CDN/host estático (Vercel, Netlify, Cloudflare Pages…) com **fallback de SPA** para `index.html`, defina as duas variáveis `VITE_*` no painel do host e inclua o domínio nas *Redirect URLs* do Supabase. Novas migrations devem terminar concedendo explicitamente os acessos (objetos novos não herdam permissões).

## 9. Limitações conhecidas

* Telas autenticadas **não foram exercitadas contra um Supabase real nesta entrega** (não havia credenciais): a lógica foi validada por testes de domínio, de banco (PGlite) e de interface com dependências simuladas; falta um teste manual ponta a ponta no seu projeto.
* Carga completa dos lançamentos no cliente (paginada em lotes de 1.000) para saldos/relatórios; só a lista de Movimentações é paginada no servidor. Para muitos anos de histórico, vale mover agregações para views/RPC.
* Orçamento guarda só o limite atual (alterá‑lo muda a leitura de meses passados).
* Feriados não entram no ajuste de datas; sem conversão de moedas (BRL); sem limite de tentativas no endpoint de convite além do rate limit do Supabase Auth.
* Editar valor/data de parcela individual não é permitido (cancele o parcelamento e refaça); cancelar plano com fatura já paga é recusado (use estorno).
* Mascote e identidade visuais próprios (inspirados na direção pedida); as referências visuais citadas no briefing não foram anexadas à conversa.
