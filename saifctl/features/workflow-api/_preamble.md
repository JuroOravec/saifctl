Project conventions (always-needed preamble):

- Comments must reflect reality. If a TODO is done, delete it; do not flip
  it to "done" and leave the body. Lazy "(see X)" comments are not
  acceptable.
- Optional inputs whose default elevates access (e.g. `requireAuth =
  false`) are bugs even if the spec is silent on them. Default deny.
- Silent failure (`catch {}`, swallowed errors, fallthroughs returning
  success on partial state) is a bug; surface the failure with context.

Divergence rules (apply to BOTH implementer and critic):

The implementer prompt grants permission to modify
`saifctl/features/workflow-api/plan.md` AND the phase's own `spec.md`
when implementation deviates from what they describe. That permission is
narrow — it exists so the spec stays in sync with what was actually
built, not so the agent can renegotiate scope.

**Valid deviation — structurally impossible plan.**
The plan / spec describes an approach that cannot be implemented as
written, discovered during implementation. Examples:

- A library API the plan assumes doesn't exist in the pinned version.
- A type the schema requires would create a circular dependency the
  runtime can't resolve.
- A field name the plan picks collides with a reserved keyword.

In these cases: update the plan / spec to reflect the discovered
constraint, implement the closest equivalent that achieves the same
goal, and leave a `> **Implementation divergence (YYYY-MM-DD):**`
note explaining what changed and why.

**Invalid deviation — scope cut.**
The work is harder, more verbose, or more tedious than the plan
suggested, but is still mechanically possible. Examples that are NOT
acceptable as "divergence":

- "The schema has 20 fields and I only implemented 12, the rest can
  land later" — implement all 20.
- "The acceptance criterion is awkward to satisfy under my chosen
  shape, so I'm dropping it" — re-shape; the acceptance criterion is
  the contract.
- "I'm skipping the security validator because the spec was
  unclear" — read the linked workflow-api.md section; if still
  unclear, ask for clarification via a finding (critic) or a TODO
  in the spec that's clearly marked unresolved.

The critic flags any plan / spec edit that looks like scope reduction
without a structural justification — including silent omissions
(an acceptance bullet that quietly disappears from the spec). Plan
edits stand only when paired with the structural reason in the
divergence note.
