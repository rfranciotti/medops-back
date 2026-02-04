# MedOps Back-End 🏥

**Sistema de análise clínica inteligente para documentação médica via Telegram**

## 📋 Visão Geral

O MedOps Back-End é um sistema de processamento de linguagem natural (NLP) projetado para auxiliar profissionais de saúde na documentação de casos clínicos. Ele recebe textos livres via Telegram, extrai informações clínicas, detecta alertas críticos e retorna um sumário estruturado para exibição no bot.

---

## 🏗️ Arquitetura

```
┌─────────────┐
│   Telegram  │ (Bot burro - apenas formatação)
└──────┬──────┘
       │ POST /cases/ingest
       ▼
┌─────────────────────────────────────────┐
│      MedOps Back-End (Inteligente)      │
│                                         │
│  1️⃣  Student (Groq LLM)                │
│       Extrai fatos clínicos             │
│                                         │
│  2️⃣  Normalize (Local Regex)           │
│       Detecta gravidade qualitativa     │
│       Contexto operacional              │
│                                         │
│  3️⃣  Gate (Regras de Decisão)          │
│       Decide se roda Teacher            │
│                                         │
│  4️⃣  Teacher (Groq LLM)                │
│       Análise ABCDE + lacunas           │
│                                         │
│  5️⃣  Summary (JSON RAW)                │
│       Retorna dados estruturados        │
└─────────────────────────────────────────┘
       │ GET /cases/:id/summary
       ▼
┌─────────────┐
│   Telegram  │ (Exibe formatado)
└─────────────┘
```

---

## 🚀 Funcionalidades

### ✅ **Extração Inteligente de Dados (Student)**
- **Dados Demográficos:** Nome, idade, sexo, peso, altura
- **Sinais Vitais:** SpO2, FC, PA, temperatura, glicemia, FR
- **Comorbidades:** Diabetes, hipertensão, DPOC, etc.
- **Sintomas Adicionais:** Tosse, febre, vômitos
- **Exame Físico:** Estertores, tiragem, edema
- **Resultados de Labs:** TGO/TGP, gasometria, EEG, ECG
- **Medicações:** Antibióticos, oxigênio

### 🚨 **Sistema de Alertas (Gate)**

**Prioridade 1 - HARD RISK (Crítico):**
- SpO2 < 92% → `hard_risk_spo2_lt_92`
- Alteração neurológica → `hard_risk_neuro_change`

**Prioridade 2 - Incerteza Clínica:**
- "desconfio", "não sei", "talvez" → `uncertainty`

**Prioridade 3 - Caos Operacional:**
- Sistema caiu, fila cheia, equipe sobrecarregada → `operational_chaos`

**Prioridade 4 - Risco de Registro:**
- "não evoluiu", "esqueci de registrar" → `documentation_risk`

### 📊 **Detecções Locais (Sem LLM - Economia de Tokens)**
- Gravidade qualitativa: "saturando baixo", "chegou mal"
- Desconforto respiratório: "falta de ar", "dispneia"
- Conflitos de PA: Múltiplos valores detectados
- Problemas operacionais: Sistema, fila, equipe

### 🧠 **Análise Clínica (Teacher)**
- Análise ABCDE (Airway, Breathing, Circulation, Disability, Exposure)
- Detecção de lacunas de documentação
- Cross-reference com raw_text para recuperar dados perdidos
- Separação de achados clínicos vs incertezas

---

## 📦 Estrutura do JSON de Resposta

### Endpoint: `GET /cases/:id/summary`

```json
{
  "ok": true,
  "case_id": "case_1770156313043",
  
  "patient": {
    "name": "Joao da Silva",
    "age": 68,
    "sex": null,
    "weight_kg": null,
    "height_m": null
  },
  
  "vitals": {
    "spo2": 89,
    "hr": 108,
    "bp_systolic": 135,
    "bp_diastolic": 80,
    "temp": 38,
    "glucose": null,
    "rr": null
  },
  
  "gate": {
    "reason_code": "hard_risk_spo2_lt_92",
    "reason_human": "(SpO₂) abaixo de 92%",
    "evidences": ["SpO₂: 89%"]
  },
  
  "analysis": {
    "findings": [
      "SatO₂: 89%",
      "Febre (38°C)",
      "Ausculta: estertores na base direita",
      "TGO e TGP: normais",
      "Comorbidades conhecidas: hipertenso, diabetes"
    ],
    "missing": [
      "Meta de saturação não registrada",
      "Frequência respiratória não registrada",
      "ECG"
    ],
    "uncertainties": [
      "desconfio de algo mais grave?",
      "⚠️ CONFLITO: Múltiplos valores de PA encontrados (18/12, 135x80)"
    ]
  },
  
  "clinical_scores": {
    "imc": {
      "value": 26.0,
      "classification": "Sobrepeso"
    },
    "shock_index": {
      "value": 0.8,
      "alert": "⚠️"
    }
  },
  
  "operational_context": {
    "chaos_detected": false,
    "issues": []
  }
}
```

---

## 🛠️ Tecnologias

- **Runtime:** Node.js + TypeScript
- **Framework:** Fastify
- **Banco de Dados:** SQLite (better-sqlite3)
- **LLM:** Groq API (llama-3.3-70b-versatile)
- **Validação:** Zod

---

## ⚙️ Configuração

### **1. Variáveis de Ambiente (.env)**

```env
PORT=3333
GROQ_API_KEY=your_groq_api_key_here
STUDENT_PROVIDER=groq    # ou "fixtures" para desenvolvimento
TEACHER_PROVIDER=groq    # ou "rules" para fallback
```

### **2. Instalação**

```bash
npm install
```

### **3. Executar**

```bash
npm run dev
```

---

## 📚 Endpoints Principais

### **POST /cases/ingest**
Recebe texto livre e processa o caso.

**Request:**
```json
{
  "raw_text": "Paciente Joao, 68a, dispneia há 2 dias, SpO2 89%..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "caseId": "case_1770156313043",
    "ranTeacher": true,
    "reason": "hard_risk_spo2_lt_92"
  }
}
```

### **GET /cases/:id/summary**
Retorna o sumário estruturado do caso.

### **GET /cases/:id**
Retorna o caso completo (raw_text, student_facts, teacher_output).

### **POST /cases/wipe**
Limpa todos os casos do banco (cuidado!).

---

## 🧪 Versão Atual: **v2.0 - "Clean Output"**

### **Changelog (2026-02-03):**

#### ✨ **Novidades:**
1. **Schema expandido do Student:**
   - `comorbidities[]` - Doenças prévias
   - `physical_exam.findings[]` - Achados de exame físico
   - `lab_results[]` - Resultados de labs com status (done/pending/not_done)
   - `presenting_problem.duration` - Duração dos sintomas
   - `presenting_problem.additional_symptoms[]` - Sintomas além da queixa

2. **Teacher agora recebe `raw_text`:**
   - Cross-reference para recuperar dados que o Student perdeu
   - Detecção de negações ("não fiz ECG", "sem gasometria")

3. **Enriquecimento de Achados:**
   - TGO e TGP agrupados: "TGO e TGP: normais"
   - Febre com temperatura: "Febre (38°C)"
   - Comorbidades rotuladas: "Comorbidades conhecidas: diabetes, hipertenso"
   - Estertores incluídos automaticamente

4. **Detecção de Conflitos:**
   - Múltiplas PAs → Alerta em `uncertainties`

5. **Shock Index inteligente:**
   - Só exibido se >= 0.8 (alerta)

#### 🐛 **Correções:**
- Gate agora prioriza SpO2 < 92 ANTES de uncertainties
- "Desconfio..." movido de findings → uncertainties
- "Local de atendimento" e "Data de referência" removidos (irrelevantes)
- Duplicatas entre findings e missing eliminadas

#### 🚀 **Performance:**
- Detecções locais (regex) evitam chamadas LLM desnecessárias
- Economia de ~30% de tokens

---

## 📖 Guia de Uso para o Bot

O Bot deve:
1. **Enviar** texto livre via `POST /cases/ingest`
2. **Pegar** o `caseId` retornado
3. **Buscar** sumário via `GET /cases/:caseId/summary`
4. **Exibir** no Telegram:
   - `gate.reason_human` → Motivo do alerta
   - `analysis.findings` → 📝 Resumo dos Achados
   - `analysis.uncertainties` → ⚠️ Incertezas e Conflitos
   - `analysis.missing` → 🧾 Pendências de Registro
   - `operational_context.issues` → 🚨 Contexto Operacional (se chaos_detected)

---

## 🤝 Contribuindo

1. Nunca modifique diretamente os prompts sem testar em casos reais
2. Sempre adicione filtros de limpeza no `teacher.normalize.ts`
3. Mantenha o Gate simples e baseado em regras
4. Documente mudanças no schema

---

## 📝 Licença

Proprietário - MedOps Team © 2026
