"""Block 0.5 smoke test — round-trips Block 0.3's fixture workflows through
the generated Pydantic models. Verifies (per implementation-plan.md §3.2
acceptance): camelCase JSON ↔ snake_case Python alias survives the chain,
x-saifctl-sensitive metadata is preserved as Pydantic field metadata, and
discriminated source / sink unions parse correctly via Pydantic v2's
smart-union fallback (with explicit-discriminator improvement tracked
as a v1.1 derive-script enhancement, see implementation-plan.md §3.4.5).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from workflow_schema import Workflow


FIXTURES_DIR = Path(__file__).resolve().parent.parent / "workflow-fixtures"


def main() -> int:
    fixtures = sorted(FIXTURES_DIR.glob("*.workflow.json"))
    if len(fixtures) < 3:
        print(f"FAIL — expected >= 3 fixtures, found {len(fixtures)}", file=sys.stderr)
        return 1

    print(f"Found {len(fixtures)} fixtures under {FIXTURES_DIR}")

    sensitive_count = 0
    for fixture_path in fixtures:
        raw = json.loads(fixture_path.read_text())
        try:
            workflow = Workflow.model_validate(raw)
        except Exception as exc:  # noqa: BLE001 — surface the full error
            print(f"FAIL — {fixture_path.name}: {exc}", file=sys.stderr)
            return 1

        # Verify camelCase round-trip on emit (alias must be respected).
        emitted = workflow.model_dump(by_alias=True, exclude_none=True)
        for key in raw:
            if key not in emitted:
                print(
                    f"FAIL — {fixture_path.name}: key {key!r} missing from emit",
                    file=sys.stderr,
                )
                return 1

        # Verify x-saifctl-sensitive metadata survives onto the model.
        # Discriminated unions land as RootModel wrappers; walk to `.root`
        # to reach the actual variant's fields.
        def count_sensitive(model: object) -> int:
            inner = getattr(model, "root", model)
            count = 0
            for _, field_info in type(inner).model_fields.items():
                extra = field_info.json_schema_extra
                if isinstance(extra, dict) and extra.get("x-saifctl-sensitive") is True:
                    count += 1
            return count

        for source in workflow.sources or []:
            sensitive_count += count_sensitive(source)
        for sink in workflow.sinks or []:
            sensitive_count += count_sensitive(sink)

        print(f"  OK — {fixture_path.name}")

    if sensitive_count == 0:
        print("FAIL — no x-saifctl-sensitive metadata observed on any model", file=sys.stderr)
        return 1
    print(f"OK — observed {sensitive_count} x-saifctl-sensitive field hits across fixtures")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
