---
id: services
explains: how saifctl acts as a Macro-Orchestrator over Infrastructure-as-Code (Docker Compose, eventually Helm) so agents can run real databases, queues, and external service mocks during tests
learning_outcomes:
  - Why the agent + tests need real services (not mocks) — agents over-fit to mocks, and integration tests need real network behaviour.
  - 'The Macro-Orchestrator model: saifctl delegates to standard IaC tools rather than reinvent the wheel.'
  - "Two phases each with their own environment: coding (the agent's container) and staging (where validation runs against the agent's diff)."
  - The `engine:` field per environment selects the infrastructure layer (`docker`, `local`, `helm` planned).
  - Trade-offs vs. fully-isolated mocks (test fidelity vs. test speed).
analogies:
  - docker-compose up but for agent-driven validation
  - test fixtures as a service topology, not a JSON file
---

Body intent: explain why services exist as a separate primitive in saifctl, and the IaC delegation choice. Cross-link `concepts/infra.md` for the engine choice.
