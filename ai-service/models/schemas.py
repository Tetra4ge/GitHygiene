"""Pydantic request/response schemas for the two engine stages.

Phases/Phase_07.md §3 (Stage 1) and Phase_08.md §2 (Stage 3). Both response
schemas double as the Gemini API structured-output schema the model is
constrained to — see llm/gemini_client.py.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


# --- Stage 1 — advisory -> vulnerable surface -----------------------------


class ExtractSurfaceRequest(BaseModel):
    osv_id: str
    aliases: list[str] = Field(default_factory=list)
    summary: str = ""
    details: Optional[str] = None
    ecosystem: str
    package_name: str


class VulnerableSurface(BaseModel):
    vulnerable_symbols: list[str] = Field(default_factory=list)
    vulnerable_subpaths: list[str] = Field(default_factory=list)
    vulnerable_configs: list[str] = Field(default_factory=list)
    trigger_conditions: list[str] = Field(default_factory=list)
    attack_vector: str = ""
    needs_untrusted_input: bool = False
    exploit_requires_runtime: Literal["server", "client", "build", "unknown"] = "unknown"
    extraction_confidence: Literal["low", "medium", "high"] = "low"
    notes: str = ""


class ExtractSurfaceResponse(VulnerableSurface):
    model: str = ""
    from_ecosystem_specific: bool = False


# --- Stage 2 — evidence (assembled by api-gateway, passed through) -------


class ImportSite(BaseModel):
    file: str
    line: int
    text: str


class CallSite(BaseModel):
    file: str
    line: int
    symbol: str
    snippet: str


class Evidence(BaseModel):
    package_imported: bool
    import_sites: list[ImportSite] = Field(default_factory=list)
    call_sites: list[CallSite] = Field(default_factory=list)
    searched_files: int = 0
    truncated: bool = False


# --- Stage 3 — reachability verdict and remediation -----------------------


class DependencyFacts(BaseModel):
    is_direct: bool
    installed_version: str
    fixed_version: Optional[str] = None
    latest_version: Optional[str] = None
    major_versions_behind: Optional[int] = None
    is_dev_dependency: bool = False
    dependency_path: Optional[List[str]] = None  # from Phase 6; None = unknown
    package_manager: str


class RepositoryFacts(BaseModel):
    kind: Literal["library", "application", "unknown"] = "unknown"
    entry_point_files: list[str] = Field(default_factory=list)
    package_manager: str


class AssessRequest(BaseModel):
    osv_id: str
    severity: str
    summary: str
    surface: VulnerableSurface
    evidence: Evidence
    dependency: DependencyFacts
    repository: RepositoryFacts


class VerdictEvidence(BaseModel):
    file: str
    line: int
    why: str


class RemediationStrategy(BaseModel):
    strategy: Literal["direct-bump", "override"]
    direct_dependency: Optional[str] = None


class AlternativeConsidered(BaseModel):
    option: str
    rejected_because: str


class AssessResponse(BaseModel):
    reachability: Literal["reachable", "likely_reachable", "not_evidenced", "unused"]
    confidence: Literal["low", "medium", "high"]
    evidence: list[VerdictEvidence] = Field(default_factory=list)
    recommendation: Literal["upgrade", "replace", "mitigate", "accept"]
    target_version: Optional[str] = None
    reasoning: str
    breaking_change_risk: Literal["low", "medium", "high"] = "low"
    breaking_change_note: str = ""
    remediation_mechanics: RemediationStrategy
    files_to_change: list[str] = Field(default_factory=list)
    tests_to_run: list[str] = Field(default_factory=list)
    side_effects: list[str] = Field(default_factory=list)
    effort: Literal["minutes", "hours", "days"] = "minutes"
    alternatives_considered: list[AlternativeConsidered] = Field(default_factory=list)
    insufficient_evidence: bool = False
    model: str = ""


# --- Phase 9 — issue drafting (one model call, draft-only) ---------------


class DraftIssueRequest(BaseModel):
    package_name: str
    osv_id: str
    severity: str
    reachability: str
    difficulty: Literal["beginner", "intermediate", "advanced"]
    rank: float
    summary: str
    reasoning: str
    evidence: list[VerdictEvidence] = Field(default_factory=list)
    target_version: Optional[str] = None
    recommendation: str


class IssueDraft(BaseModel):
    title: str
    problem_statement: str
    why_it_matters: str
    suggested_files: list[str] = Field(default_factory=list)
    scope: str
    acceptance_criteria: list[str] = Field(default_factory=list)
    skills_needed: list[str] = Field(default_factory=list)


class DraftIssueResponse(IssueDraft):
    model: str = ""
