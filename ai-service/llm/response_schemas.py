"""Gemini API structured-output schemas (OpenAPI 3.0 Schema subset) for the
two engine stages. Hand-written rather than derived from the Pydantic models
in models/schemas.py, because Gemini's schema dialect does not support the
$defs/anyOf shapes Pydantic emits for Optional fields and nested models.
"""

STAGE1_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "vulnerable_symbols": {"type": "array", "items": {"type": "string"}},
        "vulnerable_subpaths": {"type": "array", "items": {"type": "string"}},
        "vulnerable_configs": {"type": "array", "items": {"type": "string"}},
        "trigger_conditions": {"type": "array", "items": {"type": "string"}},
        "attack_vector": {"type": "string"},
        "needs_untrusted_input": {"type": "boolean"},
        "exploit_requires_runtime": {
            "type": "string",
            "enum": ["server", "client", "build", "unknown"],
        },
        "extraction_confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "notes": {"type": "string"},
    },
    "required": [
        "vulnerable_symbols",
        "vulnerable_subpaths",
        "vulnerable_configs",
        "trigger_conditions",
        "attack_vector",
        "needs_untrusted_input",
        "exploit_requires_runtime",
        "extraction_confidence",
        "notes",
    ],
}

_VERDICT_EVIDENCE_SCHEMA = {
    "type": "object",
    "properties": {
        "file": {"type": "string"},
        "line": {"type": "integer"},
        "why": {"type": "string"},
    },
    "required": ["file", "line", "why"],
}

_ALTERNATIVE_SCHEMA = {
    "type": "object",
    "properties": {
        "option": {"type": "string"},
        "rejected_because": {"type": "string"},
    },
    "required": ["option", "rejected_because"],
}

STAGE3_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "reachability": {
            "type": "string",
            "enum": ["reachable", "likely_reachable", "not_evidenced", "unused"],
        },
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "evidence": {"type": "array", "items": _VERDICT_EVIDENCE_SCHEMA},
        "recommendation": {"type": "string", "enum": ["upgrade", "replace", "mitigate", "accept"]},
        "target_version": {"type": "string", "nullable": True},
        "reasoning": {"type": "string"},
        "breaking_change_risk": {"type": "string", "enum": ["low", "medium", "high"]},
        "breaking_change_note": {"type": "string"},
        "remediation_mechanics": {
            "type": "object",
            "properties": {
                "strategy": {"type": "string", "enum": ["direct-bump", "override"]},
                "direct_dependency": {"type": "string", "nullable": True},
            },
            "required": ["strategy"],
        },
        "files_to_change": {"type": "array", "items": {"type": "string"}},
        "tests_to_run": {"type": "array", "items": {"type": "string"}},
        "side_effects": {"type": "array", "items": {"type": "string"}},
        "effort": {"type": "string", "enum": ["minutes", "hours", "days"]},
        "alternatives_considered": {"type": "array", "items": _ALTERNATIVE_SCHEMA},
        "insufficient_evidence": {"type": "boolean"},
    },
    "required": [
        "reachability",
        "confidence",
        "evidence",
        "recommendation",
        "reasoning",
        "breaking_change_risk",
        "remediation_mechanics",
        "files_to_change",
        "effort",
        "insufficient_evidence",
    ],
}

DRAFT_ISSUE_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "problem_statement": {"type": "string"},
        "why_it_matters": {"type": "string"},
        "suggested_files": {"type": "array", "items": {"type": "string"}},
        "scope": {"type": "string"},
        "acceptance_criteria": {"type": "array", "items": {"type": "string"}},
        "skills_needed": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["title", "problem_statement", "why_it_matters", "suggested_files", "scope", "acceptance_criteria"],
}
