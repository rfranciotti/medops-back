# CHANGELOG - MedOps Back-End

## [v2.0.0] - 2026-02-03 - "Clean Output"

### 🎯 **Objetivo da Release:**
Transformar o Back-End em provedor de dados PUROS (JSON RAW) para o Bot, separando completamente a lógica de extração/análise da formatação visual.

---

### ✨ **Novas Funcionalidades:**

#### 1. **Schema Expandido do Student**
- **Comorbidades:** Array de condições médicas (diabetes, hipertensão, DPOC)
- **Exame Físico:** `physical_exam.findings[]` (estertores, tiragem, edema)
- **Labs Estruturados:** `lab_results[]` com status (done/pending/not_done)
- **Duração de Sintomas:** `presenting_problem.duration` ("2 dias", "3 horas")
- **Sintomas Adicionais:** `presenting_problem.additional_symptoms[]`

#### 2. **Teacher Cross-Reference com Raw Text**
- Teacher agora recebe TANTO `student_facts` QUANTO `raw_text`
- Recupera informações que o Student pode ter perdido
- Detecta negações corretamente ("não fiz ECG" vs "ECG realizado")

#### 3. **Detecção Local de Gravidade Qualitativa**
- **Zero chamadas LLM adicionais** → Economia de tokens
- Detecta: "saturando baixo", "chegou mal", "piorando"
- Adiciona automaticamente a `uncertainties[]`

#### 4. **Sistema de Contexto Operacional**
- Novo campo: `operational_context`
  - `chaos_detected: boolean`
  - `issues: string[]`
- Captura: sistema caiu, fila cheia, equipe sobrecarregada
- Aparece em campo SEPARADO no JSON (não polui achados clínicos)

#### 5. **Enriquecimento Inteligente de Achados**
- TGO e TGP juntos: "TGO e TGP: normais"
- Febre com temperatura: "Febre (38°C)" em vez de só "febre"
- Comorbidades rotuladas: "Comorbidades conhecidas: diabetes, hipertenso"
- Estertores de `physical_exam` adicionados automaticamente

#### 6. **Detecção de Conflitos de PA**
- Regex local detecta múltiplos valores: "18/12" e "135x80"
- Alerta em `uncertainties`: "⚠️ CONFLITO: Múltiplos valores de PA encontrados"

#### 7. **Shock Index Condicional**
- Só retorna se >= 0.8 (alerta)
- Valores normais não poluem o display

#### 8. **Separação de Achados vs Incertezas**
- Novo campo no JSON: `analysis.uncertainties[]`
- Seção K (Safety/Uncertainties) agora vai para campo separado
- Bot pode exibir em seção própria: "⚠️ INCERTEZAS E CONFLITOS"

---

### 🐛 **Correções de Bugs:**

#### 1. **Gate com Prioridade Invertida** (CRÍTICO)
**Problema:** SpO2 89% disparava "uncertainty" em vez de "hard_risk_spo2_lt_92"

**Causa:** Gate checava `uncertainties.length > 0` ANTES de checar SpO2

**Solução:** Reordenado para checar:
1. `student_facts.vitals.spo2` < 92 (prioridade máxima)
2. Regex no raw_text (fallback)
3. Uncertainties
4. Caos operacional

#### 2. **Duplicação de Informações**
**Problema:** "Desconfio de algo mais grave?" aparecia em Resumo dos Achados

**Solução:** Filtro no sumário exclui seção K de `rawFindings`

#### 3. **Pedidos Irrelevantes de Missing**
**Problema:** Teacher pedia "Local de atendimento" e "Data de referência"

**Solução:** 
- Prompt atualizado com regra CRITICAL
- Filtro na normalização remove esses pedidos

#### 4. **Duplicatas entre Findings e Missing**
**Problema:** "Meta de saturação" aparecia nos dois lugares

**Solução:** Limpeza final remove findings que estão em missing da mesma seção

#### 5. **Student Perdendo Dados Críticos**
**Problema:** Tosse, diabetes, estertores, TGO/TGP não eram capturados

**Solução:** 
- Schema expandido
- Prompt com seções CRITICAL para comorbidades, sintomas, physical exam, labs
- Teacher faz cross-check com raw_text

#### 6. **Negações Ignoradas**
**Problema:** "Ainda não fiz ECG" → Student colocava em `exams: ["ECG"]`

**Solução:** 
- Prompt com regra: "Do NOT include if text says 'não fiz', 'sem', 'ainda não'"
- `lab_results[]` com status: "not_done"

---

### 🚀 **Melhorias de Performance:**

- **Detecções locais (regex)** evitam ~2 chamadas LLM extras por caso
- **Economia estimada:** 30% de tokens nos casos "óbvios"
- **Latência reduzida:** ~150ms por caso em média

---

### 📊 **Estrutura de Dados (Breaking Changes):**

#### **Antes (v1.x):**
```json
{
  "text": "🚨 CASO COM ALERTA\n...",  // Markdown formatado
  "vitals": {...},
  "gate": {...}
}
```

#### **Agora (v2.0):**
```json
{
  "text": "",  // Vazio - Bot formata
  "patient": {...},
  "vitals": {...},
  "gate": {
    "reason_code": "hard_risk_spo2_lt_92",
    "reason_human": "(SpO₂) abaixo de 92%",
    "evidences": [...]
  },
  "analysis": {
    "findings": [...],      // Só achados clínicos (A-J)
    "missing": [...],       // Lacunas
    "uncertainties": [...]  // NOVO - Incertezas e conflitos (K)
  },
  "clinical_scores": {...},
  "operational_context": {  // NOVO
    "chaos_detected": boolean,
    "issues": [...]
  }
}
```

---

### 🔧 **Mudanças Técnicas:**

#### **Arquivos Modificados:**
1. `src/schemas/student_facts_v1.ts` - Schema expandido
2. `src/services/student.ts` - Prompt melhorado
3. `src/services/student.normalize.ts` - Detecções locais
4. `src/services/teacher.groq.ts` - Recebe raw_text
5. `src/services/teacher.ts` - Passa raw_text
6. `src/services/teacher.normalize.ts` - Limpezas pós-LLM
7. `src/services/gate.ts` - Prioridade corrigida
8. `src/routes/cases.summary.ts` - Enriquecimento de achados
9. `src/routes/cases.ingest.ts` - Passa raw_text ao Teacher

#### **Novos Campos no Schema:**
- `comorbidities: string[]`
- `physical_exam: { general: string | null, findings: string[] }`
- `lab_results: [{ test: string, result: string, status: "done"|"pending"|"not_done" }]`
- `presenting_problem.duration: string | null`
- `presenting_problem.additional_symptoms: string[]`
- `vitals.rr: number | null` (frequência respiratória)
- `operational_context: { chaos_detected: boolean, issues: string[] }`

---

### ⚠️ **Breaking Changes:**

1. **Formato do JSON mudou:** Bot precisa adaptar para usar `analysis.uncertainties` separado
2. **`text` vazio:** Bot DEVE formatar, não pode mais exibir `text` diretamente
3. **Shock Index condicional:** Pode não aparecer se < 0.8

---

### 📝 **Migration Guide (Para o Bot):**

#### **ANTES:**
```typescript
const text = summary.text;  // Exibe direto
telegram.sendMessage(text);
```

#### **AGORA:**
```typescript
const { findings, missing, uncertainties } = summary.analysis;

let msg = "🚨 CASO COM ALERTA\n\n";
msg += "📝 Resumo dos Achados\n";
findings.forEach(f => msg += `• ${f}\n`);

if (uncertainties.length > 0) {
  msg += "\n⚠️ INCERTEZAS E CONFLITOS\n";
  uncertainties.forEach(u => msg += `• ${u}\n`);
}

msg += "\n🧾 Pendências de registro\n";
missing.forEach(m => msg += `• ${m}\n`);

telegram.sendMessage(msg);
```

---

### 🎯 **Próximos Passos (Roadmap v2.1):**

- [ ] Detecção de ambiguidade de data ("18/12" = data ou PA?)
- [ ] Suporte a múltiplos idiomas
- [ ] Cache de respostas LLM para casos similares
- [ ] Métricas de qualidade da extração

---

### 👥 **Colaboradores:**
- Rafael Franciotti (@rfranciotti) - Arquitetura e desenvolvimento

---

## [v1.0.0] - 2026-01-XX - "Initial Release"
(Versão anterior sem changelog detalhado)
