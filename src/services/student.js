export async function runStudent(raw_text) {
    // stub: depois troca pela chamada ao LLM
    return {
        meta: {
            schema_version: "student_facts_v1",
            language: "pt-BR",
            source: "free_text",
        },
        raw_len: raw_text.length,
        uncertainties: [],
    };
}
