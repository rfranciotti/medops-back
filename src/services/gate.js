export function runGate(student_facts, raw_text) {
    const hasUncertainty = Array.isArray(student_facts?.uncertainties) &&
        student_facts.uncertainties.length > 0;
    return {
        runTeacher: hasUncertainty,
        reason: hasUncertainty ? "uncertainty" : "skip_safe_case",
    };
}
