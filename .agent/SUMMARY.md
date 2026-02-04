# Projeto MedOps - Auditoria Clínica Estrita

## 🎯 Objetivo do Sistema
Transformar evoluções médicas em resumos estruturados com **foco total em segurança documental**. O sistema age como um **Auditor**, não como um assistente; seu papel é denunciar falhas, lacunas e afirmações sem evidência.

## 🏗️ Arquitetura de Auditoria (Os 4 Pilares)

### 1. Regra de Ouro (Assertion Minus Data = Uncertainty)
- **O que é**: Nenhuma afirmação clínica forte é aceita como fato sem dados objetivos.
- **Implementação**: Se o médico escreveu "sepse", "sepse grave", "grave" ou "iniciei antibiótico" mas não forneceu vitais numéricos (PA, SpO2, FC), isso **DEVE** aparecer como incerteza, nunca como achado.
- **Arquivos**: `src/services/student.ts` (Prompts) e `src/services/teacher.groq.ts` (Regras de Auditoria).

### 2. Camada Anti-Evasão Determinística (`anti-evasion.ts`)
- **O que é**: Uma camada de código puro (não-IA) que faz um pré-scan de gatilhos no texto bruto.
- **Função**: Se a IA tentar "esconder" uma incerteza para parecer mais inteligente, o código injeta a frase literal em `uncertainties` forçadamente.
- **Arquivos**: `src/services/anti-evasion.ts`.

### 3. Pipeline de Ingestão Blindado
- **Fluxo**: `Ingest` -> `Coerce Vitals` (conserta array p/ objeto) -> `Normalize + Anti-Evasion` -> `Gate` -> `Teacher`.
- **Porta Fechada**: O `Teacher` (auditor final) sempre recebe um patch de incertezas do código para que a `Section K` (Red Flags) nunca seja apagada.
- **Arquivos**: `src/routes/cases.ingest.ts`, `src/services/student.normalize.ts`, `src/services/teacher.ts`.

### 4. Renderização Estrita (Regra de Ouro na Exibição)
- **Filtros de Achados**: Bloqueia adjetivos vagos ("estável", "bom"). Só exibe o que é observável e positivo.
- **Purity Gate**: Se algo está em incertezas, não pode aparecer em achados.
- **Gaps Determinísticos**: Se mencionou "SAT" sem número, o sistema marca pendência obrigatoriamente via código.
- **Arquivos**: `src/routes/cases.summary.ts`.

## 📜 Instruções para Novos Agentes
1. **NÃO AFROUXE AS REGRAS**: Nunca permita que subjetividade vire facticidade.
2. **USE O ANTI-EVASION**: Qualquer nova regra de detecção deve ser adicionada preferencialmente no `anti-evasion.ts`.
3. **RESPEITE A ESTRUTURA**: Mantenha o formato `Categoria: "Citação literal"`.
4. **LIMPEZA DE SINTOMAS**: Sintomas repetidos da queixa principal devem ser ignorados.
