import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.main import MemoryIn, create_bug, create_component, create_decision, create_dependency, create_project, store

project = next((p for p in store.nodes.values() if p["type"] == "Project" and p["name"] == "Developer Assistant"), None)
if not project:
    project = create_project(type("Payload", (), {"model_dump": lambda self: {"name": "Developer Assistant", "description": "Demo project"}})())
component = create_component(project["id"], MemoryIn(title="Authentication Module", description="API authentication"))
dependency = create_dependency(project["id"], MemoryIn(title="JWT Middleware", version="1.x", package_manager="pip", component_id=component["id"]))
decision = create_decision(project["id"], MemoryIn(title="Use JWT authentication middleware", reason="Support the API authentication requirements", component_id=component["id"]))
bug = create_bug(project["id"], MemoryIn(title="API returns HTTP 401 after authentication update", error_message="HTTP 401", component_id=component["id"]))
print(f"Seeded {project['id']} (in-memory process only; use Neo4j adapter for persistence).")
