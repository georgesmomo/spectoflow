# Capabilities — palette + project-type adaptation

A capability is a role; an agent implements it; a skill is the procedure it runs. Workflows ask for a
capability, never a named agent — this keeps spectoflow agent-agnostic.

Palette: intake · research · analysis · architecture · planning · testing · implementation · security · quality · design · operations.

| Project type | Active capabilities |
|---|---|
| app / web / API | all |
| infra / IaC | intake, research, analysis, architecture, planning, security, quality, implementation, operations |
| data / ETL | intake, analysis, architecture, planning, testing (data quality), implementation, quality |
| study / content | intake, research, analysis, planning, quality |

For non-code projects the code-specific capabilities simply stay inactive; the workflow adapts.
